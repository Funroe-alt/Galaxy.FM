const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');

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
  try {
    await ytDlp('https://www.youtube.com/watch?v=' + videoId, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '192K',
      output: outTemplate,
      noPlaylist: true
    });
    downloads[videoId].status = 'uploading';
    const mp3 = path.join(TEMP_DIR, safeName + '.mp3');
    let filePath = fs.existsSync(mp3) ? mp3 : null;
    if (!filePath) {
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(safeName));
      if (!files.length) throw new Error('File not found');
      filePath = path.join(TEMP_DIR, files[0]);
    }
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      public_id: 'galaxyfm/' + videoId,
      overwrite: true
    });
    try { fs.unlinkSync(filePath); } catch(_) {}
    downloads[videoId] = { status: 'done', progress: 100, url: result.secure_url };
  } catch(err) {
    console.error(err.message);
    downloads[videoId] = { status: 'error', message: err.message };
  }
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
