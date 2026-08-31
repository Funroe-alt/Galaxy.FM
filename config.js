// config.js — Galaxy.FM API keys and settings
const CONFIG = {
  // Multiple YouTube API keys — auto-rotates when one hits quota
  YOUTUBE_API_KEYS: [
    'AIzaSyBkZnGLw5jmsi--NJsnvgs9MAI2rnmVxwA',
    'AIzaSyDG8y901RQh5yXe8qFi45RlnHUFkoR_Gbc',
    'AIzaSyBpIMFPKX2h3_jbphlW1CcqiSzCXSNupLI',
  ],
  YOUTUBE_API_KEY: 'AIzaSyBkZnGLw5jmsi--NJsnvgs9MAI2rnmVxwA', // kept for compatibility
  LASTFM_KEY: '30eb30e634c7abe1253cea9f3a761375',
  GENIUS_KEY: 'KHdsed_97wJlfDZqEBwlNDdyNxKabVGRZQAGBcHwCU3eOym_vaygpAKxRjuhJmEa',
  SERVER_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : 'https://galaxy-fm.onrender.com',
};

// YouTube key rotation
let _ytKeyIdx = parseInt(localStorage.getItem('gx-yt-key-idx') || '0');
function getYTKey() {
  return CONFIG.YOUTUBE_API_KEYS[_ytKeyIdx % CONFIG.YOUTUBE_API_KEYS.length];
}
function rotateYTKey() {
  _ytKeyIdx = (_ytKeyIdx + 1) % CONFIG.YOUTUBE_API_KEYS.length;
  localStorage.setItem('gx-yt-key-idx', _ytKeyIdx);
  console.log(`Rotated to YouTube API key ${_ytKeyIdx + 1}/${CONFIG.YOUTUBE_API_KEYS.length}`);
}

