# server.py — Galaxify Flask backend
# Handles yt-dlp downloads and serves files
# Run with: python server.py

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import os
import threading
import json

app = Flask(__name__)
CORS(app)

SONGS_DIR = os.path.join(os.path.dirname(__file__), 'songs')
os.makedirs(SONGS_DIR, exist_ok=True)

# Track download progress
downloads = {}

def do_download(video_id, title, artist):
  url = f'https://www.youtube.com/watch?v={video_id}'
  filename = f'{artist} - {title}'.replace('/', '-').replace('\\', '-')
  out_path = os.path.join(SONGS_DIR, filename)

  downloads[video_id] = {'status': 'downloading', 'progress': 0}

  def progress_hook(d):
    if d['status'] == 'downloading':
      total = d.get('total_bytes') or d.get('total_bytes_estimate', 1)
      downloaded = d.get('downloaded_bytes', 0)
      downloads[video_id]['progress'] = int((downloaded / total) * 100)
    elif d['status'] == 'finished':
      downloads[video_id]['status'] = 'processing'

  ydl_opts = {
    'format': 'bestaudio/best',
    'outtmpl': out_path + '.%(ext)s',
    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
    'progress_hooks': [progress_hook],
    'quiet': True,
  }

  try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
      ydl.download([url])
    # Find whatever file was actually downloaded
    import glob
    matches = glob.glob(out_path + '.*')
    if matches:
      actual_file = os.path.basename(matches[0])
      downloads[video_id] = {'status': 'done', 'progress': 100, 'file': actual_file}
    else:
      downloads[video_id] = {'status': 'error', 'message': 'File not found after download'}
  except Exception as e:
    downloads[video_id] = {'status': 'error', 'message': str(e)}

@app.route('/download', methods=['POST'])
def download():
  data = request.json
  video_id = data.get('videoId')
  title    = data.get('title', 'Unknown')
  artist   = data.get('artist', 'Unknown')
  if not video_id:
    return jsonify({'error': 'No videoId'}), 400
  # Check if already downloaded
  filename = f'{artist} - {title}.mp3'.replace('/', '-').replace('\\', '-')
  if os.path.exists(os.path.join(SONGS_DIR, filename)):
    return jsonify({'status': 'done', 'file': filename})
  # Start download in background
  t = threading.Thread(target=do_download, args=(video_id, title, artist))
  t.daemon = True
  t.start()
  return jsonify({'status': 'downloading', 'videoId': video_id})

@app.route('/progress/<video_id>')
def progress(video_id):
  return jsonify(downloads.get(video_id, {'status': 'unknown'}))

@app.route('/songs')
def list_songs():
  files = [f for f in os.listdir(SONGS_DIR) if f.endswith(('.mp3','.wav','.ogg','.flac','.m4a'))]
  return jsonify(files)

@app.route('/songs/<path:filename>')
def serve_song(filename):
  return send_file(os.path.join(SONGS_DIR, filename))

@app.route('/')
def index():
  return jsonify({'status': 'ok', 'app': 'Galaxify Backend', 'version': '1.0'})

@app.route('/ping')
def ping():
  return jsonify({'status': 'ok', 'version': '1.0'})

if __name__ == '__main__':
  port = int(os.environ.get('PORT', 5000))
  print(f'Galaxify server running at http://localhost:{port}')
  app.run(host='0.0.0.0', port=port, debug=False)
