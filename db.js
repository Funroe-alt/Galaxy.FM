// db.js — IndexedDB for Galaxify
const DB_NAME = 'galaxify';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('songs')) {
        d.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveSong(file, meta = {}) {
  const d = await openDB();
  const arrayBuffer = await file.arrayBuffer();
  const record = {
    title: meta.title || file.name.replace(/\.[^.]+$/, ''),
    artist: meta.artist || 'Unknown artist',
    emoji: meta.emoji || '🎵',
    color: meta.color || '#282828',
    fileName: file.name,
    fileType: file.type,
    fileData: arrayBuffer,
    addedAt: Date.now(),
    source: 'local',
  };
  return new Promise((resolve, reject) => {
    const tx = d.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

async function dbLoadAllSongs() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('songs', 'readonly');
    const req = tx.objectStore('songs').getAll();
    req.onsuccess = () => {
      resolve(req.result.map(r => {
        const blob = new Blob([r.fileData], { type: r.fileType || 'audio/mpeg' });
        return { ...r, url: URL.createObjectURL(blob), local: true };
      }));
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteSong(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbClearAll() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('songs', 'readwrite');
    const req = tx.objectStore('songs').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
