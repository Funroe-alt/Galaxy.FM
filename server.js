// server.js — Galaxy.FM Node.js backend
const express = require('express');
const cors    = require('cors');
const { execFile, exec } = require('child_process');
const cloudinary = require('cloudinary').v2;
const fs   = require('fs');
const path = require('path');
const https = require('https');

const app  = express();
app.use(cors());
app.use(express.json());

// Cloudinary config
cloudinary.config({
  cloud_name: 'xflnhfqx',
  api_key:    '577732347343432',
  api_secret: 'dN-BV1V7OkDJH48yxzwcoH-r6GQ',
  secure:     true
});

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const downloads = {};

// Download a song via yt-dlp and upload to Cloudinary
async function doDownload(videoId, title, artist) {
  const safeName = `${artist} - ${title}`.replace(/[\/\\:*?"<>|#;]/g, '');
  const outPath  = path.join(TEMP_DIR, safeName);
  const mp3Path  = outPath + '.mp3';

  downloads[videoId] = { status: 'downloading', progress: 0 };

  return new Promise((resolve) => {
    const url  = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '192K',
      '-o', outPath + '.%(ext)s',
      '--no-playlist',
      url
    ];

    const proc = execFile('yt-dlp', args, { timeout: 300000 });

    proc.stdout?.on('data', (data) => {
      const match = data.toString().match(/(\d+\.?\d*)%/);
      if (match) downloads[videoId].progress = parseFloat(match[1]);
    });

    proc.stderr?.on('data', (data) => {
      console.error('yt-dlp:', data.toString());
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        downloads[videoId] = { status: 'error', message: `yt-dlp exited with code ${code}` };
        resolve();
        return;
      }

      downloads[videoId] = { status: 'uploading', progress: 100 };

      // Find the output file
      let filePath = mp3Path;
      if (!fs.existsSync(filePath)) {
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(safeName));
        if (!files.length) {
          downloads[videoId] = { status: 'error', message: 'File not found after download' };
          resolve(); return;
        }
        filePath = path.join(TEMP_DIR, files[0]);
      }

      try {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(filePath, {
          resource_type: 'video',
          public_id:     `galaxyfm/${videoId}`,
          overwrite:     true,
        });

        // Delete temp file
        try { fs.unlinkSync(filePath); } catch (_) {}

        downloads[videoId] = {
          status:   'done',
          progress: 100,
          url:      result.secure_url,
        };
      } catch (err) {
        downloads[videoId] = { status: 'error', message: err.message };
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
      resolve();
    });
  });
}

// Routes
app.get('/', (req, res) => res.json({ status: 'ok', app: 'Galaxy.FM Backend', version: '3.0' }));
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

app.post('/download', async (req, res) => {
  const { videoId, title = 'Unknown', artist = 'Unknown' } = req.body;
  if (!videoId) return res.status(400).json({ error: 'No videoId' });

  // Check if already on Cloudinary
  try {
    const existing = await cloudinary.api.resource(`galaxyfm/${videoId}`, { resource_type: 'video' });
    return res.json({ status: 'done', url: existing.secure_url, progress: 100 });
  } catch (_) {}

  // Check if currently downloading
  const existing = downloads[videoId];
  if (existing && !['error', 'done'].includes(existing.status)) {
    return res.json({ status: existing.status, progress: existing.progress || 0 });
  }

  // Start download in background
  doDownload(videoId, title, artist);
  res.json({ status: 'downloading', videoId });
});

app.get('/progress/:videoId', (req, res) => {
  const d = downloads[req.params.videoId];
  res.json(d || { status: 'unknown' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Galaxy.FM backend running on port ${PORT}`));
