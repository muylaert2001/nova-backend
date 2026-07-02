// POST /api/analyze-video — paste this into the VPS server.js
//
// Setup on the VPS first:
//   npm install multer fluent-ffmpeg
//   sudo apt-get update && sudo apt-get install -y ffmpeg
//
// Requires `axios` to already be required in server.js (it is).
// Uses the existing OPENAI_API_KEY environment variable.

const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported video type. Use MP4, WEBM, or MOV.'));
  }
});

const MAX_VIDEO_SECONDS = 30;
const FRAME_COUNT = 6;

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration || 0);
    });
  });
}

function extractFrame(filePath, timestampSeconds, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: [timestampSeconds],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '512x?'
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

app.post('/api/analyze-video', (req, res, next) => {
  videoUpload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid video upload.' });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured on server.' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ava-video-'));
  const videoPath = path.join(tmpDir, `input${path.extname(req.file.originalname) || '.mp4'}`);

  try {
    fs.writeFileSync(videoPath, req.file.buffer);

    const duration = await probeDuration(videoPath);
    if (duration > MAX_VIDEO_SECONDS + 1) {
      return res.status(400).json({ error: `Video is too long (${Math.round(duration)}s). Max ${MAX_VIDEO_SECONDS}s.` });
    }

    const frameCount = Math.min(FRAME_COUNT, Math.max(2, Math.ceil(duration)));
    const timestamps = [];
    for (let i = 0; i < frameCount; i++) {
      timestamps.push(Math.max(0, (duration * (i + 0.5)) / frameCount));
    }

    const frameImages = [];
    for (let i = 0; i < timestamps.length; i++) {
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      await extractFrame(videoPath, timestamps[i], framePath);
      if (fs.existsSync(framePath)) {
        const b64 = fs.readFileSync(framePath).toString('base64');
        frameImages.push(`data:image/jpeg;base64,${b64}`);
      }
    }

    if (!frameImages.length) {
      return res.status(500).json({ error: 'Could not extract frames from video.' });
    }

    const content = [
      {
        type: 'text',
        text: 'These are sequential frames sampled evenly from a short video clip (under 30 seconds), in chronological order. Describe what happens in the video: the scene, subjects, actions, and any notable changes across the frames. Be concise but specific.'
      },
      ...frameImages.map((url) => ({ type: 'image_url', image_url: { url } }))
    ];

    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{ role: 'user', content }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const description = openaiRes.data.choices?.[0]?.message?.content?.trim() || 'Unable to describe this video.';
    res.json({ description });
  } catch (err) {
    const status = err.response?.status;
    const oaError = err.response?.data?.error;
    console.error('analyze-video error:', oaError || err.message);

    if (status === 401) {
      return res.status(502).json({ error: 'OpenAI API key is invalid or was revoked.' });
    }
    if (status === 429 && oaError?.code === 'insufficient_quota') {
      return res.status(502).json({ error: 'OpenAI account is out of quota — check billing at platform.openai.com/account/billing.' });
    }
    if (status === 403 && (oaError?.code === 'billing_hard_limit_reached' || /billing/i.test(oaError?.message || ''))) {
      return res.status(502).json({ error: 'OpenAI billing hard limit reached — check your usage limits.' });
    }
    if (status === 429) {
      return res.status(502).json({ error: 'OpenAI rate limit hit — try again in a moment.' });
    }
    if (status === 400 && /content_policy/i.test(oaError?.code || '')) {
      return res.status(422).json({ error: 'Video was flagged by content policy and could not be analyzed.' });
    }

    return res.status(500).json({ error: 'Video analysis failed.' });
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  }
});
