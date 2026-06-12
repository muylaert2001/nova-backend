const express = require('express');
const axios = require('axios');
const router = express.Router();

const TENANT = 'common';
const SCOPES = ['offline_access', 'Mail.Read', 'Mail.Send', 'Calendars.Read', 'Calendars.ReadWrite', 'User.Read'];

// ── Step 1: Redirect to Microsoft login ──
router.get('/connect', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    scope: SCOPES.join(' '),
    response_mode: 'query'
  });
  res.redirect(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params}`);
});

// ── Step 2: Microsoft sends user back here ──
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=microsoft_denied');
  try {
    const response = await axios.post(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
        grant_type: 'authorization_code',
        scope: SCOPES.join(' ')
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    req.session.microsoftTokens = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresAt: Date.now() + response.data.expires_in * 1000
    };
    res.redirect('/?connected=microsoft');
  } catch (err) {
    console.error('Microsoft OAuth error:', err.message);
    res.redirect('/?error=microsoft_failed');
  }
});

async function getToken(req) {
  const tokens = req.session.microsoftTokens;
  if (!tokens) return null;
  if (Date.now() > tokens.expiresAt - 60000) {
    const response = await axios.post(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPES.join(' ')
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    req.session.microsoftTokens.accessToken = response.data.access_token;
    req.session.microsoftTokens.expiresAt = Date.now() + response.data.expires_in * 1000;
  }
  return req.session.microsoftTokens.accessToken;
}

function graph(endpoint, token) {
  return axios.get(`https://graph.microsoft.com/v1.0${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

// ── Outlook: get recent emails ──
router.get('/mail', async (req, res) => {
  if (!req.session.microsoftTokens) return res.status(401).json({ error: 'Not connected to Microsoft' });
  try {
    const token = await getToken(req);
    const result = await graph('/me/messages?$top=10&$select=subject,from,receivedDateTime,bodyPreview&$filter=isRead eq false', token);
    res.json({ messages: result.data.value.map(m => ({
      id: m.id, subject: m.subject,
      from: m.from.emailAddress.address,
      received: m.receivedDateTime,
      preview: m.bodyPreview
    }))});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Outlook Calendar: upcoming events ──
router.get('/calendar', async (req, res) => {
  if (!req.session.microsoftTokens) return res.status(401).json({ error: 'Not connected to Microsoft' });
  try {
    const token = await getToken(req);
    const now = new Date().toISOString();
    const result = await graph(`/me/calendarview?startdatetime=${now}&enddatetime=${new Date(Date.now()+7*86400000).toISOString()}&$top=10&$orderby=start/dateTime`, token);
    res.json({ events: result.data.value.map(e => ({
      id: e.id, title: e.subject,
      start: e.start.dateTime, end: e.end.dateTime,
      location: e.location?.displayName || null
    }))});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
