// art.js — Album art fetcher for Galaxify
const ART_CACHE_KEY = 'galaxify-art-v1';
const artCache = JSON.parse(localStorage.getItem(ART_CACHE_KEY) || '{}');

function cleanTitle(t) {
  return t.replace(/\s*\(Official.*?\)/gi,'').replace(/\s*\[.*?\]/g,'').replace(/\s*ft\..*$/i,'').trim();
}

async function fetchArt(title, artist) {
  const key = `${title}__${artist}`.toLowerCase().trim();
  if (artCache[key] !== undefined) return artCache[key];
  const t = cleanTitle(title);
  const a = artist === 'Unknown artist' ? '' : artist;
  const result = await tryAllSources(t, a) || (a ? await tryAllSources(t, '') : null);
  artCache[key] = result || null;
  localStorage.setItem(ART_CACHE_KEY, JSON.stringify(artCache));
  return result;
}

async function tryAllSources(title, artist) {
  return await tryLastfmTrack(title, artist)
    || await tryLastfmAlbum(title, artist)
    || await tryItunes(title, artist)
    || await tryDeezer(title, artist)
    || await tryMusicBrainz(title, artist)
    || await tryItunesProxy(title, artist);
}

async function tryLastfmTrack(title, artist) {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${CONFIG.LASTFM_KEY}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const images = data?.track?.album?.image;
    if (images?.length) {
      const best = [...images].reverse().find(i => i['#text'] && !i['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f'));
      if (best?.['#text']) return best['#text'];
    }
  } catch (_) {}
  return null;
}

async function tryLastfmAlbum(title, artist) {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.search&api_key=${CONFIG.LASTFM_KEY}&album=${encodeURIComponent(title)}&format=json&limit=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results?.albummatches?.album || [];
    for (const al of results) {
      if (artist && !al.artist?.toLowerCase().includes(artist.toLowerCase().split(' ')[0])) continue;
      const best = [...(al.image||[])].reverse().find(i => i['#text'] && !i['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f'));
      if (best?.['#text']) return best['#text'];
    }
  } catch (_) {}
  return null;
}

async function tryItunes(title, artist) {
  try {
    const q = encodeURIComponent(`${title}${artist ? ' '+artist : ''}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=3&entity=song`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results?.length) return data.results[0].artworkUrl100.replace('100x100bb','600x600bb');
  } catch (_) {}
  return null;
}

async function tryDeezer(title, artist) {
  try {
    const q = encodeURIComponent(`${title}${artist ? ' '+artist : ''}`);
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://api.deezer.com/search?q='+q+'&limit=1')}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const outer = await res.json();
    const data = JSON.parse(outer.contents);
    if (data.data?.length) return data.data[0].album?.cover_xl || data.data[0].album?.cover_big || null;
  } catch (_) {}
  return null;
}

async function tryMusicBrainz(title, artist) {
  try {
    const q = encodeURIComponent(`recording:"${title}"${artist ? ' AND artist:"'+artist+'"' : ''}`);
    const res = await fetch(`https://musicbrainz.org/ws/2/recording?query=${q}&limit=3&fmt=json`, {
      headers: { 'User-Agent': 'Galaxify/1.0 (school project)' },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const rec of (data.recordings || [])) {
      const release = rec.releases?.[0];
      if (!release?.id) continue;
      try {
        const imgRes = await fetch(`https://coverartarchive.org/release/${release.id}/front-500`, { signal: AbortSignal.timeout(5000) });
        if (imgRes.ok) return imgRes.url;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

async function tryItunesProxy(title, artist) {
  try {
    const q = encodeURIComponent(`${title}${artist ? ' '+artist : ''}`);
    const itunesUrl = `https://itunes.apple.com/search?term=${q}&media=music&limit=1&entity=song`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(itunesUrl)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const outer = await res.json();
    const data = JSON.parse(outer.contents);
    if (data.results?.length) return data.results[0].artworkUrl100.replace('100x100bb','600x600bb');
  } catch (_) {}
  return null;
}

async function fetchArtForSongs(songs, onUpdate) {
  for (const s of songs) {
    if (s.art !== undefined) continue;
    const url = await fetchArt(s.title, s.artist);
    s.art = url || null;
    if (url && onUpdate) onUpdate(s);
  }
}
