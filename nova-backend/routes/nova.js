const express = require('express');
const router = express.Router();

// ── NOVA unified command endpoint ──
// NOVA's AI sends structured commands here and gets data back
// Format: POST /nova/command { service, action, params }

router.post('/command', async (req, res) => {
  const { service, action, params = {} } = req.body;

  // Route to appropriate service handler
  try {
    switch (service) {

      case 'spotify': {
        const spotify = require('./spotify');
        // Forward request internally
        const mockReq = { session: req.session, body: params };
        const mockRes = { json: (data) => res.json(data), status: (code) => ({ json: (data) => res.status(code).json(data) }) };
        if (action === 'now-playing') return spotify.handle('now-playing', mockReq, mockRes);
        if (action === 'play') return res.json(await spotifyAction(req, 'play'));
        if (action === 'pause') return res.json(await spotifyAction(req, 'pause'));
        if (action === 'next') return res.json(await spotifyAction(req, 'next'));
        if (action === 'search-play') return res.json(await spotifySearchPlay(req, params.query));
        break;
      }

      case 'gmail': {
        if (action === 'inbox') return res.json(await getGmail(req));
        if (action === 'send') return res.json(await sendGmail(req, params));
        break;
      }

      case 'calendar': {
        const provider = params.provider || 'google';
        if (action === 'upcoming') return res.json(await getCalendar(req, provider));
        if (action === 'create') return res.json(await createCalendarEvent(req, params));
        break;
      }

      case 'slack': {
        if (action === 'channels') return res.json(await getSlackChannels(req));
        if (action === 'messages') return res.json(await getSlackMessages(req, params.channelId));
        if (action === 'send') return res.json(await sendSlack(req, params));
        break;
      }

      case 'status':
        return res.json({
          google: !!(req.session.googleTokens),
          spotify: !!(req.session.spotifyTokens),
          slack: !!(req.session.slackTokens),
          microsoft: !!(req.session.microsoftTokens)
        });

      default:
        return res.status(400).json({ error: `Unknown service: ${service}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Daily briefing endpoint ──
// NOVA calls this at startup or on request to get a full summary
router.get('/briefing', async (req, res) => {
  const briefing = { timestamp: new Date().toISOString(), sections: [] };

  // Gmail unread count
  if (req.session.googleTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
      oauth2.setCredentials(req.session.googleTokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      const list = await gmail.users.messages.list({ userId: 'me', maxResults: 5, q: 'is:unread' });
      briefing.sections.push({ service: 'gmail', type: 'unread', count: list.data.resultSizeEstimate || 0 });
    } catch (e) { briefing.sections.push({ service: 'gmail', error: e.message }); }
  }

  // Calendar events today
  if (req.session.googleTokens) {
    try {
      const { google } = require('googleapis');
      const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
      oauth2.setCredentials(req.session.googleTokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2 });
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const result = await calendar.events.list({
        calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(),
        singleEvents: true, orderBy: 'startTime'
      });
      briefing.sections.push({ service: 'calendar', type: 'today', events: result.data.items.map(e => ({ title: e.summary, start: e.start.dateTime || e.start.date })) });
    } catch (e) { briefing.sections.push({ service: 'calendar', error: e.message }); }
  }

  // Spotify now playing
  if (req.session.spotifyTokens) {
    try {
      const SpotifyWebApi = require('spotify-web-api-node');
      const api = new SpotifyWebApi({ clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET, redirectUri: process.env.SPOTIFY_REDIRECT_URI });
      api.setAccessToken(req.session.spotifyTokens.accessToken);
      const data = await api.getMyCurrentPlayingTrack();
      if (data.body?.item) {
        briefing.sections.push({ service: 'spotify', playing: data.body.is_playing, track: data.body.item.name, artist: data.body.item.artists[0].name });
      }
    } catch (e) {}
  }

  res.json(briefing);
});

module.exports = router;
