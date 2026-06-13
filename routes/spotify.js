const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const router = express.Router();

function getClient(tokens) {
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

async function getTokens() {
  try {
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const data = await client.get('tokens:spotify');
    await client.quit();
    return data ? JSON.parse(data) : null;
  } catch(e) { return null; }
}

async function saveTokens(tokens) {
  try {
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    await client.set('tokens:spotify', JSON.stringify(tokens));
    await client.quit();
  } catch(e) {}
}

router.get('/connect', (req, res) => {
  try {
    const api = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });
    const scopes = ['user-read-playback-state','user-modify-playback-state','user-read-currently-playing','playlist-read-private','user-library-read'];
    const url = api.createAuthorizeURL(scopes, 'nova');
    console.log('Redirecting to Spotify:', url);
    res.redirect(url);
  } catch(err) {
    console.error('Spotify connect error:', err.message);
    res.redirect('/?error=spotify_connect_failed');
  }
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=spotify_denied');
  try {
    const api = getClient();
    const data = await api.authorizationCodeGrant(code);
    await saveTokens({
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresAt: Date.now() + data.body.expires_in * 1000
    });
    res.redirect('/?connected=spotify');
  } catch (err) {
    console.error('Spotify OAuth error:', err.message);
    res.redirect('/?error=spotify_failed');
  }
});

router.get('/now-playing', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected to Spotify' });
  try {
    const api = getClient(tokens);
    const data = await api.getMyCurrentPlayingTrack();
    if (!data.body || !data.body.item) return res.json({ playing: false });
    const track = data.body.item;
    res.json({
      playing: data.body.is_playing,
      track: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      progress: data.body.progress_ms,
      duration: track.duration_ms
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/play', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = getClient(tokens); await api.play(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pause', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = getClient(tokens); await api.pause(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/next', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = getClient(tokens); await api.skipToNext(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/previous', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected' });
  try { const api = getClient(tokens); await api.skipToPrevious(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/search-play', async (req, res) => {
  const tokens = await getTokens();
  if (!tokens) return res.status(401).json({ error: 'Not connected' });
  const { query } = req.body;
  try {
    const api = getClient(tokens);
    const results = await api.searchTracks(query, { limit: 1 });
    const track = results.body.tracks.items[0];
    if (!track) return res.json({ success: false, message: 'No track found' });
    await api.play({ uris: [track.uri] });
    res.json({ success: true, track: track.name, artist: track.artists[0].name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;