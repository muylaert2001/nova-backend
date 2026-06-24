require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const googleRoutes = require('../routes/google');
const spotifyRoutes = require('../routes/spotify');
const slackRoutes = require('../routes/slack');
const microsoftRoutes = require('../routes/microsoft');
const novaRoutes = require('../routes/nova');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──
app.use(express.static(require('path').join(__dirname, '../public')));
app.use(express.json());
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'https://claude.ai', 'http://localhost:3000'],
  credentials: true
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'nova-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// ── Routes ──
app.get('/ava', requireAuth, (req, res) => res.sendFile(require('path').join(__dirname, '../protected/ava.html')));
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.AVA_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Incorrect password' });
  }
});

function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

app.use('/auth/google', googleRoutes);
app.use('/auth/spotify', spotifyRoutes);
app.use('/auth/slack', slackRoutes);
app.use('/auth/microsoft', microsoftRoutes);
app.use('/nova', novaRoutes);

// ── Health check ──
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

// ── Auth status — which services are connected ──
app.get('/status', (req, res) => {
  res.json({
    google: !!(req.session.googleTokens),
    spotify: !!(req.session.spotifyTokens),
    slack: !!(req.session.slackTokens),
    microsoft: !!(req.session.microsoftTokens)
  });
});

// ── Disconnect a service ──
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

const { createClient } = require('redis');
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
redisClient.connect().catch(console.error);

app.get('/api/memory/:key', async (req, res) => {
  try {
    const data = await redisClient.get('ava:' + req.params.key);
    res.json({ value: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memory/:key', async (req, res) => {
  try {
    await redisClient.set('ava:' + req.params.key, JSON.stringify(req.body.value));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sms', async (req, res) => {
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const { to, message } = req.body;
    const result = await twilio.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders', async (req, res) => {
  try {
    const { message, dueAt, phone } = req.body;
    const id = Date.now().toString();
    const reminder = { id, message, dueAt, phone, sent: false };
    await redisClient.set('reminder:' + id, JSON.stringify(reminder));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reminders', async (req, res) => {
  try {
    const keys = await redisClient.keys('reminder:*');
    const reminders = [];
    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) reminders.push(JSON.parse(data));
    }
    res.json({ reminders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

setInterval(async () => {
  try {
    const keys = await redisClient.keys('reminder:*');
    const now = Date.now();
    for (const key of keys) {
      const data = await redisClient.get(key);
      if (!data) continue;
      const reminder = JSON.parse(data);
      if (!reminder.sent && new Date(reminder.dueAt).getTime() <= now) {
        console.log('Reminder due:', reminder.message);
        if (reminder.phone) {
          try {
            const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await twilio.messages.create({ body: 'AVA Reminder: ' + reminder.message, from: process.env.TWILIO_PHONE_NUMBER, to: reminder.phone });
          } catch (e) { console.log('SMS reminder failed:', e.message); }
        }
        reminder.sent = true;
        await redisClient.set(key, JSON.stringify(reminder));
      }
    }
  } catch (err) { console.log('Reminder check error:', err.message); }
}, 60000);

app.post('/api/reminders/:id/notified', async (req, res) => {
  try {
    const data = await redisClient.get('reminder:' + req.params.id);
    if (data) {
      const reminder = JSON.parse(data);
      reminder.notified = true;
      await redisClient.set('reminder:' + req.params.id, JSON.stringify(reminder));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🟣 NOVA Backend running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/`);
  console.log(`   Auth status:  http://localhost:${PORT}/status\n`);
});
