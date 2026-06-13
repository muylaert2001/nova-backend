require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const cors = require('cors');
const path = require('path');

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

const googleRoutes = require('../routes/google');
const spotifyRoutes = require('../routes/spotify');
const slackRoutes = require('../routes/slack');
const microsoftRoutes = require('../routes/microsoft');
const novaRoutes = require('../routes/nova');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'nova-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 90 * 24 * 60 * 60 * 1000
  }
}));

app.get('/auth/spotify/connect', (req, res) => {
  console.log('Direct spotify connect hit!');
  const SpotifyWebApi = require('spotify-web-api-node');
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
  const scopes = ['user-read-playback-state','user-modify-playback-state','user-read-currently-playing','playlist-read-private','user-library-read'];
  const url = api.createAuthorizeURL(scopes, 'nova');
  console.log('URL:', url);
  res.send(`<html><body><script>window.location.href='${url}'</script><a href="${url}">Click here to connect Spotify</a></body></html>`);
});
app.use('/auth/google', googleRoutes);
console.log('Loading spotify routes:', typeof spotifyRoutes);
app.use('/auth/spotify', spotifyRoutes);
app.use('/auth/slack', slackRoutes);
app.use('/auth/microsoft', microsoftRoutes);
app.use('/nova', novaRoutes);

app.get('/', (req, res) => {
  res.json({
    status: 'NOVA backend online',
    version: '1.0.0',
    services: {
      google: !!process.env.GOOGLE_CLIENT_ID,
      spotify: !!process.env.SPOTIFY_CLIENT_ID,
      slack: !!process.env.SLACK_CLIENT_ID,
      microsoft: !!process.env.MICROSOFT_CLIENT_ID
    }
  });
});

app.get('/status', async (req, res) => {
  try {
    const spotify = await redisClient.get('tokens:spotify');
    const google = await redisClient.get('tokens:google');
    res.json({
      google: !!google,
      spotify: !!spotify,
      slack: false,
      microsoft: false
    });
  } catch(e) {
    res.json({ google: false, spotify: false, slack: false, microsoft: false });
  }
});

app.get('/test-spotify', (req, res) => {
  res.json({
    clientId: process.env.SPOTIFY_CLIENT_ID ? 'SET' : 'MISSING',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ? 'SET' : 'MISSING',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
});

app.listen(PORT, () => {
  console.log(`\n🟣 NOVA Backend running on port ${PORT}`);
});