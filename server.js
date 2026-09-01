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
    path.join(__dirname, 'yt-dlp')
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
  const dest = path.join(__dirname, 'yt-dlp');
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

app.get('/debug', (req, res) => {
  const tempDir = path.join(__dirname, 'temp');
  const files = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
  res.json({ tempDir, files, downloads, ytdlp: YTDLP });
});
  res.json(downloads[req.params.videoId] || { status: 'unknown' });
});

async function doDownload(videoId, title, artist) {
  downloads[videoId] = { status: 'downloading', progress: 0 };
  return new Promise((resolve) => {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    // Use --get-url to get direct stream URL - much less memory than downloading
    const args = [
      '-x',
      '-f', 'bestaudio/best',
      '-o', path.join(__dirname, 'temp', videoId + '.%(ext)s'),
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=ios',
      '--user-agent', 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
    ];
    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
    args.push('https://www.youtube.com/watch?v=' + videoId);

    let output = '';
    const proc = execFile(YTDLP, args, { timeout: 300000 });
    proc.stdout?.on('data', (d) => { output += d.toString(); const m = d.toString().match(/(\d+\.?\d*)%/); if(m) downloads[videoId].progress=parseFloat(m[1]); });
    proc.stderr?.on('data', (d) => { output += d.toString(); console.error('yt-dlp:', d.toString()); });

    proc.on('close', async (code) => {
      console.log('yt-dlp exit:', code, output.slice(0, 300));
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: output.slice(0, 300) || 'yt-dlp failed' };
        return resolve();
      }
      downloads[videoId].status = 'uploading';
      // Find downloaded file
      const files = fs.readdirSync(path.join(__dirname, 'temp')).filter(f => f.startsWith(videoId));
      if (!files.length) {
        downloads[videoId] = { status: 'error', message: 'File not found after download' };
        return resolve();
      }
      const filePath = path.join(__dirname, 'temp', files[0]);
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
  // Update yt-dlp to latest version
  try {
    execSync(bin + ' -U 2>/dev/null || true', { stdio: 'pipe', timeout: 30000 });
    console.log('yt-dlp updated');
  } catch(_) {}
  console.log('yt-dlp ready:', YTDLP);
  app.listen(PORT, () => console.log('Galaxy.FM backend on port ' + PORT));
});
