// POST /api/tts — OpenAI text-to-speech proxy for AVA.
// Add this route alongside the other /api/* routes in server.js on the VPS.
// Requires OPENAI_API_KEY to be set in that server's environment.
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: 'nova',
        instructions: 'Speak with calm authority - warm, precise, and confident. Like a highly capable personal AI assistant.',
        response_format: 'mp3'
      })
    });

    if (!openaiRes.ok) {
      console.error('OpenAI TTS error:', await openaiRes.text());
      return res.status(502).json({ error: 'TTS generation failed' });
    }

    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(await openaiRes.arrayBuffer()));
  } catch (e) {
    console.error('TTS endpoint error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
