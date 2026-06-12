require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const cors = require('cors');

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

const googleRoutes = require('../routes/google');
const spotifyRoutes = require('../routes/spotify');
const slackRoutes = require('../routes/slack');
const microsoftRoutes = require('../routes/microsoft');
const novaRoutes = require('../routes/nova');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'https://claude.ai', 'http://localhost:3000'],
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

app.use('/auth/google', googleRoutes);
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

app.get('/status', (req, res) => {
  res.json({
    google: !!(req.session.googleTokens),
    spotify: !!(req.session.spotifyTokens),
    slack: !!(req.session.slackTokens),
    microsoft: !!(req.session.microsoftTokens)
  });
});

app.post('/disconnect/:service', (req, res) => {
  const { service } = req.params;
  const key = `${service}Tokens`;
  if (req.session[key]) {
    delete req.session[key];
    res.json({ success: true, message: `${service} disconnected` });
  } else {
    res.json({ success: false, message: `${service} was not connected` });
  }
});

app.listen(PORT, () => {
  console.log(`\n🟣 NOVA Backend running on port ${PORT}`);
});