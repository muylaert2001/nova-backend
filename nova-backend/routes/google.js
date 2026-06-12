const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ── Step 1: Redirect user to Google login ──
router.get('/connect', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  });
  res.redirect(url);
});

// ── Step 2: Google sends user back here ──
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=google_denied');
  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    req.session.googleTokens = tokens;
    res.redirect('/?connected=google');
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/?error=google_failed');
  }
});

// ── Gmail: get recent emails ──
router.get('/gmail', async (req, res) => {
  if (!req.session.googleTokens) return res.status(401).json({ error: 'Not connected to Google' });
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(req.session.googleTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const list = await gmail.users.messages.list({ userId: 'me', maxResults: 10, q: 'is:unread' });
    const messages = await Promise.all(
      (list.data.messages || []).map(async (msg) => {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'] });
        const headers = detail.data.payload.headers;
        const get = (name) => headers.find(h => h.name === name)?.value || '';
        return { id: msg.id, from: get('From'), subject: get('Subject'), date: get('Date'), snippet: detail.data.snippet };
      })
    );
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Gmail: send an email ──
router.post('/gmail/send', async (req, res) => {
  if (!req.session.googleTokens) return res.status(401).json({ error: 'Not connected to Google' });
  const { to, subject, body } = req.body;
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(req.session.googleTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const raw = Buffer.from(`To: ${to}\nSubject: ${subject}\n\n${body}`).toString('base64url');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Calendar: get upcoming events ──
router.get('/calendar', async (req, res) => {
  if (!req.session.googleTokens) return res.status(401).json({ error: 'Not connected to Google' });
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(req.session.googleTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const result = await calendar.events.list({
      calendarId: 'primary', timeMin: new Date().toISOString(),
      maxResults: 10, singleEvents: true, orderBy: 'startTime'
    });
    const events = result.data.items.map(e => ({
      id: e.id, title: e.summary,
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      location: e.location || null,
      description: e.description || null
    }));
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Calendar: create an event ──
router.post('/calendar/create', async (req, res) => {
  if (!req.session.googleTokens) return res.status(401).json({ error: 'Not connected to Google' });
  const { title, start, end, description, location } = req.body;
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(req.session.googleTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: { summary: title, description, location,
        start: { dateTime: start, timeZone: 'America/Detroit' },
        end: { dateTime: end, timeZone: 'America/Detroit' } }
    });
    res.json({ success: true, eventId: event.data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
