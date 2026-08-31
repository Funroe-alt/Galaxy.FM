# server.py — Galaxy.FM Flask backend
# Downloads audio via yt-dlp and stores permanently on Cloudinary

from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import os
import threading
import cloudinary
import cloudinary.uploader

import subprocess
import urllib.request

def ensure_ffmpeg():
  # Check if ffmpeg is already available
  try:
    subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    print('ffmpeg found in PATH')
    return 'ffmpeg'
  except: pass

  # Check /app/ffmpeg
  if os.path.exists('/app/ffmpeg'):
    print('ffmpeg found at /app/ffmpeg')
    return '/app/ffmpeg'

  # Download static ffmpeg binary
  print('Downloading ffmpeg...')
  try:
    url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/linux-x64'
    dest = '/app/ffmpeg'
    urllib.request.urlretrieve(url, dest)
    os.chmod(dest, 0o755)
    print('ffmpeg downloaded successfully')
    return dest
  except Exception as e:
    print(f'Failed to download ffmpeg: {e}')
    return None

app = Flask(__name__)
CORS(app)

# Cloudinary config
cloudinary.config(
  cloud_name = 'xflnhfqx',
  api_key    = '577732347343432',
  api_secret = 'dN-BV1V7OkDJH48yxzwcoH-r6GQ',
  secure     = True
)

TEMP_DIR = os.path.join(os.path.dirname(__file__), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

downloads = {}

def do_download(video_id, title, artist):
  safe_name = f'{artist} - {title}'.replace('/', '-').replace('\\', '-').replace(':', '-')
  out_path   = os.path.join(TEMP_DIR, safe_name)
  downloads[video_id] = {'status': 'downloading', 'progress': 0}

  def progress_hook(d):
    if d['status'] == 'downloading':
      total      = d.get('total_bytes') or d.get('total_bytes_estimate', 1)
      downloaded = d.get('downloaded_bytes', 0)
      downloads[video_id]['progress'] = int((downloaded / total) * 100)
    elif d['status'] == 'finished':
      downloads[video_id]['status'] = 'processing'

  # Find ffmpeg — check local exe, then use ensure_ffmpeg
  script_dir = os.path.dirname(os.path.abspath(__file__))
  ffmpeg_loc = None
  if os.path.exists(os.path.join(script_dir, 'ffmpeg.exe')):
    ffmpeg_loc = script_dir
  elif os.path.exists('/app/ffmpeg'):
    ffmpeg_loc = '/app'
  else:
    # Try to download ffmpeg binary
    try:
      url  = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/linux-x64'
      dest = '/app/ffmpeg'
      urllib.request.urlretrieve(url, dest)
      os.chmod(dest, 0o755)
      ffmpeg_loc = '/app'
    except: pass

  ydl_opts = {
    'format': 'bestaudio/best',
    'outtmpl': out_path + '.%(ext)s',
    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
    'progress_hooks': [progress_hook],
    'quiet': True,
  }
  if ffmpeg_loc:
    ydl_opts['ffmpeg_location'] = ffmpeg_loc

  try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
      ydl.download([f'https://www.youtube.com/watch?v={video_id}'])

    mp3_path = out_path + '.mp3'
    if not os.path.exists(mp3_path):
      import glob
      matches = glob.glob(out_path + '.*')
      mp3_path = matches[0] if matches else None

    if not mp3_path:
      downloads[video_id] = {'status': 'error', 'message': 'File not found after download'}
      return

    # Upload to Cloudinary
    downloads[video_id]['status'] = 'uploading'
    result = cloudinary.uploader.upload(
      mp3_path,
      resource_type = 'video',   # Cloudinary uses 'video' for audio files
      public_id     = f'galaxyfm/{video_id}',
      overwrite     = True,
      tags          = ['galaxyfm', artist, title]
    )

    # Delete local temp file
    try: os.remove(mp3_path)
    except: pass

    cloud_url = result['secure_url']
    downloads[video_id] = {
      'status':   'done',
      'progress': 100,
      'url':      cloud_url,
      'public_id': result['public_id']
    }

  except Exception as e:
    downloads[video_id] = {'status': 'error', 'message': str(e)}
    # Clean up temp file on error
    try:
      import glob
      for f in glob.glob(out_path + '.*'):
        os.remove(f)
    except: pass

@app.route('/')
def index():
  return jsonify({'status': 'ok', 'app': 'Galaxy.FM Backend', 'version': '2.0'})

@app.route('/ping')
def ping():
  return jsonify({'status': 'ok'})

@app.route('/download', methods=['POST'])
def download():
  data     = request.json
  video_id = data.get('videoId')
  title    = data.get('title', 'Unknown')
  artist   = data.get('artist', 'Unknown')
  if not video_id:
    return jsonify({'error': 'No videoId'}), 400

  # Check if already on Cloudinary
  try:
    existing = cloudinary.api.resource(f'galaxyfm/{video_id}', resource_type='video')
    return jsonify({'status': 'done', 'url': existing['secure_url'], 'progress': 100})
  except: pass

  # Check if currently downloading
  if video_id in downloads and downloads[video_id]['status'] not in ('error', 'done'):
    return jsonify({'status': downloads[video_id]['status'], 'progress': downloads[video_id].get('progress', 0)})

  # Start download
  t = threading.Thread(target=do_download, args=(video_id, title, artist))
  t.daemon = True
  t.start()
  return jsonify({'status': 'downloading', 'videoId': video_id})

@app.route('/progress/<video_id>')
def progress(video_id):
  return jsonify(downloads.get(video_id, {'status': 'unknown'}))

if __name__ == '__main__':
  port = int(os.environ.get('PORT', 5000))
  print(f'Galaxy.FM backend running at http://localhost:{port}')
  app.run(host='0.0.0.0', port=port, debug=False)
