const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

cloudinary.config({
  cloud_name: 'xflnhfqx',
  api_key: '577732347343432',
  api_secret: 'dN-BV1V7OkDJH48yxzwcoH-r6GQ',
  secure: true
});

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const downloads = {};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          const newFile = fs.createWriteStream(dest);
          https.get(res.headers.location, { headers: { 'User-Agent': 'nodejs' } }, (res2) => {
            res2.pipe(newFile);
            newFile.on('finish', () => { newFile.close(); resolve(); });
          }).on('error', reject);
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    follow(url);
  });
}

async function ensureYtDlp() {
  // Check all possible locations
  const locations = [
    'yt-dlp',
    '/usr/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/app/yt-dlp'
  ];
  for (const loc of locations) {
    try {
      execSync(loc + ' --version 2>/dev/null', { stdio: 'pipe' });
      console.log('yt-dlp found: ' + loc);
      return loc;
    } catch(_) {}
  }

  // Try finding in nix store
  try {
    const r = execSync('find /nix /usr -name "yt-dlp" 2>/dev/null | head -1', { stdio: 'pipe', shell: true }).toString().trim();
    if (r) {
      console.log('yt-dlp found: ' + r);
      return r;
    }
  } catch(_) {}

  // Download standalone binary (no Python needed - this is the _linux executable)
  console.log('Downloading yt-dlp standalone binary...');
  const dest = '/app/yt-dlp';
  try {
    // Use the _linux standalone which includes Python bundled
    await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', dest);
    fs.chmodSync(dest, '755');
    execSync(dest + ' --version', { stdio: 'pipe' });
    console.log('yt-dlp standalone installed: ' + dest);
    return dest;
  } catch(e) {
    console.error('yt-dlp install failed:', e.message);
    return null;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

let YTDLP = null;

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Galaxy.FM', version: '3.0', ytdlp: YTDLP }));
app.get('/ping', (req, res) => res.json({ status: 'ok', ytdlp: YTDLP }));

app.post('/download', async (req, res) => {
  const { videoId, title = 'Unknown', artist = 'Unknown' } = req.body;
  if (!videoId) return res.status(400).json({ error: 'No videoId' });
  if (!YTDLP) return res.status(503).json({ error: 'yt-dlp not ready yet, try again in a moment' });

  try {
    const existing = await cloudinary.api.resource('galaxyfm/' + videoId, { resource_type: 'video' });
    return res.json({ status: 'done', url: existing.secure_url, progress: 100 });
  } catch(_) {}

  const cur = downloads[videoId];
  if (cur && cur.status !== 'error' && cur.status !== 'done') {
    return res.json({ status: cur.status, progress: cur.progress || 0 });
  }

  doDownload(videoId, title, artist);
  res.json({ status: 'downloading', videoId });
});

app.get('/progress/:videoId', (req, res) => {
  res.json(downloads[req.params.videoId] || { status: 'unknown' });
});

async function doDownload(videoId, title, artist) {
  const safeName = (artist + ' - ' + title).replace(/[\/\\:*?"<>|#;]/g, '').trim();
  const outTemplate = path.join(TEMP_DIR, safeName + '.%(ext)s');
  downloads[videoId] = { status: 'downloading', progress: 0 };

  return new Promise((resolve) => {
    const args = ['-x', '-o', outTemplate, '--no-playlist', '--newline',
      'https://www.youtube.com/watch?v=' + videoId];
    const proc = execFile(YTDLP, args, { timeout: 300000 });

    proc.stdout?.on('data', (data) => {
      const m = data.toString().match(/(\d+\.?\d*)%/);
      if (m) downloads[videoId].progress = parseFloat(m[1]);
    });
    proc.stderr?.on('data', (d) => console.error('yt-dlp stderr:', d.toString()));

    proc.on('close', async (code) => {
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: 'yt-dlp failed code ' + code };
        return resolve();
      }
      downloads[videoId].status = 'uploading';
      const exts = ['.mp3', '.m4a', '.webm', '.ogg', '.opus'];
      let filePath = null;
      for (const ext of exts) {
        const p = path.join(TEMP_DIR, safeName + ext);
        if (fs.existsSync(p)) { filePath = p; break; }
      }
      if (!filePath) {
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(safeName));
        if (files.length) filePath = path.join(TEMP_DIR, files[0]);
      }
      if (!filePath) {
        downloads[videoId] = { status: 'error', message: 'File not found after download' };
        return resolve();
      }
      try {
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: 'video', public_id: 'galaxyfm/' + videoId, overwrite: true
        });
        try { fs.unlinkSync(filePath); } catch(_) {}
        downloads[videoId] = { status: 'done', progress: 100, url: result.secure_url };
      } catch(err) {
        downloads[videoId] = { status: 'error', message: err.message };
      }
      resolve();
    });
  });
}

const PORT = process.env.PORT || 5000;
ensureYtDlp().then(bin => {
  YTDLP = bin;
  console.log('yt-dlp ready:', YTDLP);
  app.listen(PORT, () => console.log('Galaxy.FM backend on port ' + PORT));
});
