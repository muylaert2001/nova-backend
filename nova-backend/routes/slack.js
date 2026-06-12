const express = require('express');
const { WebClient } = require('@slack/web-api');
const axios = require('axios');
const router = express.Router();

// ── Step 1: Redirect to Slack login ──
router.get('/connect', (req, res) => {
  const scopes = ['channels:read', 'channels:history', 'chat:write', 'users:read'];
  const url = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${scopes.join(',')}&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI)}`;
  res.redirect(url);
});

// ── Step 2: Slack sends user back here ──
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=slack_denied');
  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI
      }
    });
    if (!response.data.ok) throw new Error(response.data.error);
    req.session.slackTokens = { accessToken: response.data.access_token, teamName: response.data.team?.name };
    res.redirect('/?connected=slack');
  } catch (err) {
    console.error('Slack OAuth error:', err.message);
    res.redirect('/?error=slack_failed');
  }
});

// ── Get channels ──
router.get('/channels', async (req, res) => {
  if (!req.session.slackTokens) return res.status(401).json({ error: 'Not connected to Slack' });
  try {
    const client = new WebClient(req.session.slackTokens.accessToken);
    const result = await client.conversations.list({ limit: 20, types: 'public_channel' });
    res.json({ channels: result.channels.map(c => ({ id: c.id, name: c.name, memberCount: c.num_members })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get recent messages from a channel ──
router.get('/messages/:channelId', async (req, res) => {
  if (!req.session.slackTokens) return res.status(401).json({ error: 'Not connected to Slack' });
  try {
    const client = new WebClient(req.session.slackTokens.accessToken);
    const result = await client.conversations.history({ channel: req.params.channelId, limit: 10 });
    res.json({ messages: result.messages.map(m => ({ text: m.text, ts: m.ts, user: m.user })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Send a message ──
router.post('/send', async (req, res) => {
  if (!req.session.slackTokens) return res.status(401).json({ error: 'Not connected to Slack' });
  const { channel, text } = req.body;
  try {
    const client = new WebClient(req.session.slackTokens.accessToken);
    await client.chat.postMessage({ channel, text });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
