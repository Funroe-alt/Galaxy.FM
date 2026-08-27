// config.js — Galaxy.FM API keys and settings
const CONFIG = {
  YOUTUBE_API_KEY: 'AIzaSyBkZnGLw5jmsi--NJsnvgs9MAI2rnmVxwA',
  LASTFM_KEY: '30eb30e634c7abe1253cea9f3a761375',
  GENIUS_KEY: 'KHdsed_97wJlfDZqEBwlNDdyNxKabVGRZQAGBcHwCU3eOym_vaygpAKxRjuhJmEa',
  // Auto-detect: use localhost when running locally, Railway when on the web
  SERVER_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : 'https://galaxify-production.up.railway.app',
};
