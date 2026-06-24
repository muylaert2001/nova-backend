const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const router = express.Router();

function getSpotifyClient(tokens) {
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
  if (tokens) {
    api.setAccessToken(tokens.accessToken);
    api.setRefreshToken(tokens.refreshToken);
  }
  return api;
}

async function refreshIfNeeded(req) {
  const tokens = req.session.spotifyTokens;
  if (!tokens) return null;
  const now = Date.now();
  if (tokens.expiresAt && now > tokens.expiresAt - 60000) {
    const api = getSpotifyClient(tokens);
    const data = await api.refreshAccessToken();
    req.session.spotifyTokens = {
      ...tokens,
      accessToken: data.body.access_token,
      expiresAt: now + data.body.expires_in * 1000
    };
  }
  return getSpotifyClient(req.session.spotifyTokens);
}

// ── Step 1: Redirect to Spotify login ──
router.get('/connect', (req, res) => {
  const api = getSpotifyClient();
  const scopes = ['user-read-playback-state', 'user-modify-playback-state',
    'user-read-currently-playing', 'playlist-read-private', 'user-library-read'];
  const state = Math.random().toString(36).substring(7);
  req.session.spotifyState = state;
  res.redirect(api.createAuthorizeURL(scopes, state));
});

// ── Step 2: Spotify sends user back here ──
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?error=spotify_denied');
  try {
    const api = getSpotifyClient();
    const data = await api.authorizationCodeGrant(code);
    req.session.spotifyTokens = {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + data.body.expires_in * 1000
    };
    res.redirect('/?connected=spotify');
  } catch (err) {
    console.error('Spotify OAuth error:', err.message);
    res.redirect('/?error=spotify_failed');
  }
});

// ── Now playing ──
router.get('/now-playing', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected to Spotify' });
  try {
    const api = await refreshIfNeeded(req);
    const data = await api.getMyCurrentPlayingTrack();
    if (!data.body || !data.body.item) return res.json({ playing: false });
    const track = data.body.item;
    res.json({
      playing: data.body.is_playing,
      track: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url,
      progress: data.body.progress_ms,
      duration: track.duration_ms
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Playback controls ──
router.post('/play', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected to Spotify' });
  try {
    const api = await refreshIfNeeded(req);
    await api.play();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pause', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected to Spotify' });
  try {
    const api = await refreshIfNeeded(req);
    await api.pause();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/next', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = await refreshIfNeeded(req); await api.skipToNext(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/previous', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = await refreshIfNeeded(req); await api.skipToPrevious(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Search and play a track ──
router.post('/search-play', async (req, res) => {
  if (!req.session.spotifyTokens) return res.status(401).json({ error: 'Not connected to Spotify' });
  const { query } = req.body;
  try {
    const api = await refreshIfNeeded(req);
    const results = await api.searchTracks(query, { limit: 1 });
    const track = results.body.tracks.items[0];
    if (!track) return res.json({ success: false, message: 'No track found' });
    const devices = await api.getMyDevices();
    const activeDevice = devices.body.devices.find(d => d.is_active) || devices.body.devices[0];
    if (!activeDevice) return res.json({ success: false, message: 'No Spotify device found. Please open Spotify on a device first.' });
    await api.play({ uris: [track.uri], device_id: activeDevice.id });
    res.json({ success: true, track: track.name, artist: track.artists[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
