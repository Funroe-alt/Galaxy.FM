const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Install yt-dlp if not found
function ensureYtDlp() {
  try {
    execSync('yt-dlp --version', { stdio: 'pipe' });
    console.log('yt-dlp found');
    return 'yt-dlp';
  } catch(_) {}
  // Download yt-dlp binary
  const dest = '/app/yt-dlp';
  console.log('Downloading yt-dlp...');
  try {
    execSync('curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ' + dest + ' && chmod +x ' + dest);
    console.log('yt-dlp installed at ' + dest);
    return dest;
  } catch(e) {
    console.error('Failed to install yt-dlp:', e.message);
    return 'yt-dlp';
  }
}

const YTDLP = ensureYtDlp();

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

    const proc = execFile(YTDLP, args, { timeout: 300000 });

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Galaxy.FM backend on port ' + PORT));
