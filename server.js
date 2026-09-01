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
  const dest = path.join(__dirname, 'yt-dlp');
  const locations = ['yt-dlp', '/usr/bin/yt-dlp', dest];
  for (const loc of locations) {
    try { execSync(loc + ' --version', { stdio: 'pipe' }); console.log('yt-dlp: ' + loc); return loc; } catch(_) {}
  }
  console.log('Downloading yt-dlp...');
  await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', dest);
  fs.chmodSync(dest, '755');
  console.log('yt-dlp installed: ' + dest);
  return dest;
}

async function ensureDeno() {
  try { execSync('deno --version', { stdio: 'pipe' }); console.log('Deno found'); return; } catch(_) {}
  try {
    console.log('Installing Deno...');
    execSync('curl -fsSL https://deno.land/install.sh | sh 2>/dev/null || true', { stdio: 'pipe', shell: true, timeout: 60000 });
    const denoPath = path.join(process.env.HOME || '/root', '.deno', 'bin', 'deno');
    if (fs.existsSync(denoPath)) {
      process.env.PATH = process.env.PATH + ':' + path.dirname(denoPath);
      console.log('Deno installed at ' + denoPath);
    }
  } catch(e) { console.error('Deno install failed:', e.message); }
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
    ];
    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
    args.push('https://www.youtube.com/watch?v=' + videoId);

    let output = '';
    const env = Object.assign({}, process.env);
    const proc = execFile(YTDLP, args, { timeout: 300000, env: env });
    proc.stdout.on('data', (d) => { output += d.toString(); const m = d.toString().match(/(\d+\.?\d*)%/); if (m) downloads[videoId].progress = parseFloat(m[1]); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    proc.on('close', async (code) => {
      console.log('yt-dlp exit: ' + code);
      console.log('output: ' + output.slice(0, 400));
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: output.slice(0, 300) };
        return resolve();
      }
      const files = fs.readdirSync(TEMP_DIR).filter(function(f) { return f.startsWith(videoId); });
      if (!files.length) {
        downloads[videoId] = { status: 'error', message: 'File not found. ' + output.slice(0, 200) };
        return resolve();
      }
      downloads[videoId].status = 'uploading';
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

app.get('/', function(req, res) { res.json({ status: 'ok', app: 'Galaxy.FM', version: '3.0', ytdlp: YTDLP }); });
app.get('/ping', function(req, res) { res.json({ status: 'ok', ytdlp: YTDLP }); });

app.get('/debug', function(req, res) {
  const files = fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR) : [];
  res.json({ TEMP_DIR: TEMP_DIR, files: files, downloads: downloads, ytdlp: YTDLP });
});

app.get('/test/:videoId', function(req, res) {
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  const args = ['--dump-json', '--no-playlist'];
  if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
  args.push('https://www.youtube.com/watch?v=' + req.params.videoId);
  let out = '';
  const proc = execFile(YTDLP, args, { timeout: 30000 });
  proc.stdout.on('data', function(d) { out += d.toString(); });
  proc.stderr.on('data', function(d) { out += d.toString(); });
  proc.on('close', function(code) { res.json({ code: code, output: out.slice(0, 1000) }); });
});

app.post('/download', async function(req, res) {
  const videoId = req.body.videoId;
  const title = req.body.title || 'Unknown';
  const artist = req.body.artist || 'Unknown';
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
  res.json({ status: 'downloading', videoId: videoId });
});

app.get('/progress/:videoId', function(req, res) {
  res.json(downloads[req.params.videoId] || { status: 'unknown' });
});

const PORT = process.env.PORT || 5000;

ensureYtDlp().then(async function(bin) {
  YTDLP = bin;
  await ensureDeno();
  try { execSync(bin + ' -U', { stdio: 'pipe', timeout: 30000 }); console.log('yt-dlp updated'); } catch(_) {}
  app.listen(PORT, function() { console.log('Galaxy.FM backend on port ' + PORT); });
}).catch(function(err) {
  console.error('Failed:', err.message);
  process.exit(1);
});
