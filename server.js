const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Install yt-dlp if not found
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location);
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
  // Check common locations
  const locations = ['yt-dlp', '/app/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/nix/var/nix/profiles/default/bin/yt-dlp'];
  for (const loc of locations) {
    try {
      execSync(loc + ' --version', { stdio: 'pipe' });
      console.log('yt-dlp found at: ' + loc);
      return loc;
    } catch(_) {}
  }
  // Try finding it
  try {
    const found = execSync('find /nix -name "yt-dlp" 2>/dev/null | head -1', { stdio: 'pipe' }).toString().trim();
    if (found) { console.log('yt-dlp found at: ' + found); return found; }
  } catch(_) {}

  // Download Python yt-dlp
  console.log('Downloading yt-dlp...');
  try {
    await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', '/app/yt-dlp');
    fs.chmodSync('/app/yt-dlp', '755');
    // Try with python3
    execSync('python3 /app/yt-dlp --version', { stdio: 'pipe' });
    console.log('yt-dlp works with python3');
    return 'python3 /app/yt-dlp';
  } catch(e) {
    console.error('yt-dlp setup failed:', e.message);
    return 'yt-dlp';
  }
}

const app = express();
app.use(cors());
app.use(express.json());

cloudinary.config({
  cloud_name: 'xflnhfqx',
  api_key: '577732347343432',
  api_secret: 'dN-BV1V7OkDJH48yxzwcoH-r6GQ',
  secure: true
});

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const downloads = {};

async function doDownload(videoId, title, artist) {
  const safeName = (artist + ' - ' + title).replace(/[\/\\:*?"<>|#;]/g, '').trim();
  const outTemplate = path.join(TEMP_DIR, safeName + '.%(ext)s');
  downloads[videoId] = { status: 'downloading', progress: 0 };

  return new Promise((resolve) => {
    const args = [
      '-x',
      '-o', outTemplate, '--no-playlist',
      '--newline',
      '--no-check-certificate',
      'https://www.youtube.com/watch?v=' + videoId
    ];

    const ytdlpParts = YTDLP.split(' ');
    const cmd = ytdlpParts[0];
    const cmdArgs = ytdlpParts.length > 1 ? [...ytdlpParts.slice(1), ...args] : args;
    const proc = execFile(cmd, cmdArgs, { timeout: 300000 });

    proc.stdout.on('data', (data) => {
      const match = data.toString().match(/(\d+\.?\d*)%/);
      if (match) downloads[videoId].progress = parseFloat(match[1]);
    });

    proc.stderr.on('data', (data) => console.error('yt-dlp:', data.toString()));

    proc.on('close', async (code) => {
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: 'yt-dlp failed with code ' + code };
        return resolve();
      }
      downloads[videoId].status = 'uploading';
      const AUDIO_EXTS = ['.mp3', '.m4a', '.webm', '.ogg', '.opus', '.wav'];
      let filePath = null;
      for (const ext of AUDIO_EXTS) {
        const p = path.join(TEMP_DIR, safeName + ext);
        if (fs.existsSync(p)) { filePath = p; break; }
      }
      if (!filePath) {
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(safeName));
        if (!files.length) {
          downloads[videoId] = { status: 'error', message: 'File not found' };
          return resolve();
        }
        filePath = path.join(TEMP_DIR, files[0]);
      }
      try {
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: 'video',
          public_id: 'galaxyfm/' + videoId,
          overwrite: true
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

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Galaxy.FM', version: '3.0' }));
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

app.post('/download', async (req, res) => {
  const { videoId, title = 'Unknown', artist = 'Unknown' } = req.body;
  if (!videoId) return res.status(400).json({ error: 'No videoId' });
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

let YTDLP = 'yt-dlp';
const PORT = process.env.PORT || 5000;

ensureYtDlp().then(bin => {
  YTDLP = bin;
  app.listen(PORT, () => console.log('Galaxy.FM backend on port ' + PORT));
});
