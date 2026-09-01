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
let YTDLP = null;

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const file = fs.createWriteStream(dest);
      https.get(u, { headers: { 'User-Agent': 'nodejs' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.destroy();
          try { fs.unlinkSync(dest); } catch(_) {}
          follow(res.headers.location);
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function ensureYtDlp() {
  const locations = ['yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', path.join(__dirname, 'yt-dlp')];
  for (const loc of locations) {
    try {
      execSync(loc + ' --version', { stdio: 'pipe' });
      console.log('yt-dlp found: ' + loc);
      return loc;
    } catch(_) {}
  }
  try {
    const found = execSync('find /nix /usr -name "yt-dlp" 2>/dev/null | head -1', { stdio: 'pipe', shell: true }).toString().trim();
    if (found) { console.log('yt-dlp found: ' + found); return found; }
  } catch(_) {}
  const dest = path.join(__dirname, 'yt-dlp');
  console.log('Downloading yt-dlp standalone binary...');
  await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', dest);
  fs.chmodSync(dest, '755');
  execSync(dest + ' --version', { stdio: 'pipe' });
  console.log('yt-dlp standalone installed: ' + dest);
  return dest;
}

async function doDownload(videoId, title, artist) {
  downloads[videoId] = { status: 'downloading', progress: 0 };
  return new Promise((resolve) => {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const outPath = path.join(TEMP_DIR, videoId + '.%(ext)s');
    const args = [
      '-x', '-f', 'bestaudio/best',
      '-o', outPath,
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=ios',
      '--user-agent', 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
    ];
    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
    args.push('https://www.youtube.com/watch?v=' + videoId);

    let output = '';
    const proc = execFile(YTDLP, args, { timeout: 300000 });
    proc.stdout.on('data', (d) => { output += d.toString(); const m = d.toString().match(/(\d+\.?\d*)%/); if (m) downloads[videoId].progress = parseFloat(m[1]); });
    proc.stderr.on('data', (d) => { output += d.toString(); console.error('yt-dlp:', d.toString()); });
    proc.on('close', async (code) => {
      console.log('yt-dlp exit:', code);
      console.log('yt-dlp output:', output.slice(0, 500));
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: output.slice(0, 300) || 'yt-dlp failed code ' + code };
        return resolve();
      }
      downloads[videoId].status = 'uploading';
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(videoId));
      if (!files.length) {
        downloads[videoId] = { status: 'error', message: 'File not found. Output: ' + output.slice(0, 200) };
        return resolve();
      }
      const filePath = path.join(TEMP_DIR, files[0]);
      try {
        const result = await cloudinary.uploader.upload(filePath, { resource_type: 'video', public_id: 'galaxyfm/' + videoId, overwrite: true });
        try { fs.unlinkSync(filePath); } catch(_) {}
        downloads[videoId] = { status: 'done', progress: 100, url: result.secure_url };
      } catch(err) {
        downloads[videoId] = { status: 'error', message: err.message };
      }
      resolve();
    });
  });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Galaxy.FM', version: '3.0', ytdlp: YTDLP }));
app.get('/ping', (req, res) => res.json({ status: 'ok', ytdlp: YTDLP }));

app.get('/test/:videoId', (req, res) => {
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  const args = ['--dump-json', '--no-playlist', '--extractor-args', 'youtube:player_client=ios'];
  if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
  args.push('https://www.youtube.com/watch?v=' + req.params.videoId);
  let out = '';
  const proc = execFile(YTDLP, args, { timeout: 30000 });
  proc.stdout.on('data', d => out += d.toString());
  proc.stderr.on('data', d => out += d.toString());
  proc.on('close', (code) => res.json({ code, output: out.slice(0, 1000) }));
});

app.get('/debug', (req, res) => {
  const files = fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : [];
  res.json({ TEMP_DIR, files, downloads, ytdlp: YTDLP });
});

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

const PORT = process.env.PORT || 5000;
ensureYtDlp().then(bin => {
  YTDLP = bin;
  try { execSync(bin + ' -U 2>/dev/null || true', { stdio: 'pipe', timeout: 30000 }); console.log('yt-dlp updated'); } catch(_) {}
  app.listen(PORT, () => console.log('Galaxy.FM backend on port ' + PORT));
}).catch(err => {
  console.error('Failed to setup yt-dlp:', err.message);
  process.exit(1);
});
