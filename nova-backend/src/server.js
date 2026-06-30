require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
redisClient.connect().catch(console.error);
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
  store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
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


const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const axios = require('axios');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: 'audio.webm', contentType: req.file.mimetype });
    form.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        ...form.getHeaders()
      }
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response ? JSON.stringify(err.response.data) : err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AVA Tray Routes  —  paste this block into your VPS server.js
//
// Written for node-redis v4 (createClient API).
// Assumes your server.js already has:
//   const { createClient } = require('redis');
//   const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
//   redisClient.connect().catch(console.error);
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Prevent unhandled Redis TimeoutErrors from crashing the process
process.on('unhandledRejection', (err) => {
  if (err && err.name === 'TimeoutError') return;
  console.error('[server] Unhandled rejection:', err);
});


// Prevent unhandled Redis timeouts from crashing the process
process.on('unhandledRejection', (err) => {
  if (err && err.name === 'TimeoutError') return; // ignore Redis brPop timeouts
  console.error('[server] Unhandled rejection:', err);
});

const r = redisClient; // matches your existing variable name

// ── Auth: all tray-facing endpoints verify this token ──
function trayAuth(req, res, next) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== process.env.TRAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tray/register
// Tray calls this once on startup. Records device metadata and sets heartbeat.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/tray/register', trayAuth, async (req, res) => {
  try {
    const { deviceId, platform, hostname } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    await Promise.all([
      r.sAdd('tray:devices', deviceId),
      r.hSet(`tray:device:${deviceId}`, {
        platform:      platform || '',
        hostname:      hostname || '',
        registeredAt:  String(Date.now()),
      }),
      r.set(`tray:heartbeat:${deviceId}`, String(Date.now()), { EX: 35 }),
    ]);

    console.log(`[tray] Registered: ${deviceId} (${platform} / ${hostname})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[tray] Register error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tray/poll?timeout=20000
// Long-poll: holds the connection until a command is queued for this device,
// or the timeout elapses. The tray loops on this immediately after each return.
//
// node-redis v4 note: brPop ties up its connection, so we duplicate the client
// and connect it fresh per request, then disconnect in the finally block.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/tray/poll', trayAuth, async (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'X-Device-Id header required' });

  // Clamp timeout to [5s, 30s]; tray sends 20000ms → 20s
  const timeoutMs  = Math.min(Math.max(parseInt(req.query.timeout) || 20000, 5000), 30000);
  const timeoutSec = Math.ceil(timeoutMs / 1000);

  // Refresh heartbeat: this device is alive right now
  await r.set(`tray:heartbeat:${deviceId}`, String(Date.now()), { EX: 35 });

  // node-redis v4: duplicate() returns an unconnected copy — must call connect()
  const bc = r.duplicate();
  await bc.connect();
  try {
    // brPop blocks until an item arrives or timeoutSec elapses.
    // Returns { key, element } on success, null on timeout.
    const entry = await bc.brPop(`tray:queue:${deviceId}`, timeoutSec);

    if (!entry) {
      // Timeout with no command — tray will immediately call /poll again
      return res.json({ commandId: null });
    }

    const command = JSON.parse(entry.element);
    console.log(`[tray] Dispatched → ${deviceId}:`, command.action, command.param ?? '');
    res.json(command); // { commandId, action, param }
  } catch (e) {
    console.error('[tray] Poll error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  } finally {
    await bc.disconnect();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tray/result
// Tray posts the outcome after executing a command locally.
// Result is stored for 2 minutes — long enough for any UI poll to read it.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/tray/result', trayAuth, async (req, res) => {
  try {
    const { commandId, result, error } = req.body;
    if (!commandId) return res.status(400).json({ error: 'commandId required' });

    // Piggyback heartbeat refresh on every tray communication
    const deviceId = req.headers['x-device-id'];
    if (deviceId) await r.set(`tray:heartbeat:${deviceId}`, String(Date.now()), { EX: 35 });

    await r.set(
      `tray:result:${commandId}`,
      JSON.stringify({ result: result ?? null, error: error ?? null, completedAt: Date.now() }),
      { EX: 120 }
    );

    console.log(`[tray] Result for ${commandId}: ${result ?? ('ERROR: ' + error)}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[tray] Result error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tray/command
// AVA web UI enqueues a local action on a device.
//
// Body: { action: 'openApp', param: 'spotify', deviceId: 'thomas-desktop' }
// deviceId is optional — omit to auto-route to whichever device is online.
//
// Auth note: this is called by your web UI (logged-in user), not the tray.
// Add your existing session/JWT middleware here if needed.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/tray/command', async (req, res) => {
  try {
    const { action, param } = req.body;
    let { deviceId } = req.body;

    if (!action) return res.status(400).json({ error: 'action required' });

    // ── Auto-route: pick the device with the most recent heartbeat ──
    if (!deviceId) {
      const knownDevices = await r.sMembers('tray:devices');
      if (!knownDevices.length) {
        return res.status(503).json({ error: 'No tray devices registered' });
      }

      let latestTs = 0;
      for (const id of knownDevices) {
        const ts = parseInt(await r.get(`tray:heartbeat:${id}`)) || 0;
        if (ts > latestTs) { latestTs = ts; deviceId = id; }
      }

      if (!deviceId || Date.now() - latestTs > 35000) {
        return res.status(503).json({ error: 'No tray device is currently online' });
      }
    }

    const commandId = crypto.randomUUID();
    await r.lPush(`tray:queue:${deviceId}`, JSON.stringify({ commandId, action, param }));

    console.log(`[tray] Queued ${commandId} → ${deviceId}: ${action}(${param ?? ''})`);
    res.json({ commandId, deviceId });
  } catch (e) {
    console.error('[tray] Command error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tray/result/:commandId
// AVA web UI polls this after sending a command to check if it's been executed.
//
// Usage in the browser:
//   const { commandId } = await fetch('/api/tray/command', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ action: 'openApp', param: 'spotify' })
//   }).then(r => r.json());
//
//   let out;
//   do {
//     await new Promise(r => setTimeout(r, 500));
//     out = await fetch(`/api/tray/result/${commandId}`).then(r => r.json());
//   } while (out.pending);
//   console.log(out.result); // e.g. "Opening spotify"
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/tray/result/:commandId', async (req, res) => {
  try {
    const raw = await r.get(`tray:result:${req.params.commandId}`);
    if (!raw) return res.json({ pending: true });
    res.json({ pending: false, ...JSON.parse(raw) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tray/devices
// Returns all registered devices and whether each is currently online.
// Useful for a device-picker in the AVA UI when multiple devices are registered.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/tray/devices', async (req, res) => {
  try {
    const ids = await r.sMembers('tray:devices');
    const devices = await Promise.all(ids.map(async (id) => {
      const [meta, hb] = await Promise.all([
        r.hGetAll(`tray:device:${id}`),
        r.get(`tray:heartbeat:${id}`),
      ]);
      return {
        deviceId: id,
        platform:  meta?.platform || null,
        hostname:  meta?.hostname || null,
        online:    !!hb,
        lastSeen:  hb ? parseInt(hb) : null,
      };
    }));
    res.json(devices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.listen(PORT, () => {
  console.log(`\n🟣 NOVA Backend running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/`);
  console.log(`   Auth status:  http://localhost:${PORT}/status\n`);
});
