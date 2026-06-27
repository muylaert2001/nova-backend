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

