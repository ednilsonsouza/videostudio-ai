import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

if (!process.env.GEMINI_API_KEY) {
  console.error('\u26a0\ufe0f  GEMINI_API_KEY not found in .env file');
  console.error('   Create a .env file with: GEMINI_API_KEY=your_key_here');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const MODELS = {
  'veo-3.1-generate-preview': 'Veo 3.1 \u2014 Melhor qualidade (Com \u00e1udio)',
  'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast \u2014 Mais r\u00e1pido (Com \u00e1udio)',
  'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite \u2014 Mais barato (Com \u00e1udio)',
  'veo-2.0-generate-001': 'Veo 2.0 \u2014 Sem \u00e1udio',
};

// POST /api/generate \u2014 inicia gera\u00e7\u00e3o e retorna operationName
app.post('/api/generate', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY n\u00e3o configurada no servidor.' });
  }

  const {
    prompt,
    aspectRatio = '9:16',
    durationSeconds = 8,
    model = 'veo-3.1-generate-preview',
  } = req.body;

  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'Prompt \u00e9 obrigat\u00f3rio.' });
  }

  try {
    const operation = await ai.models.generateVideos({
      model,
      prompt: prompt.trim(),
      config: {
        aspectRatio,
        durationSeconds: Number(durationSeconds),
      },
    });

    res.json({ operationName: operation.name });
  } catch (err) {
    console.error('/api/generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status?op=... \u2014 consulta status da opera\u00e7\u00e3o Gemini
app.get('/api/status', async (req, res) => {
  const { op } = req.query;
  if (!op) {
    return res.status(400).json({ error: 'Par\u00e2metro "op" (operationName) \u00e9 obrigat\u00f3rio.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY n\u00e3o configurada.' });
  }

  let operation;

  try {
    operation = await ai.operations.get({ operation: { name: op } });
  } catch {
    try {
      const opPath = op.startsWith('http') ? new URL(op).pathname.replace(/^\//, '') : op;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${opPath}?key=${apiKey}`
      );
      if (!r.ok) {
        const body = await r.text();
        return res.status(r.status).json({ error: `Erro na opera\u00e7\u00e3o: ${body.slice(0, 200)}` });
      }
      operation = await r.json();
    } catch (fetchErr) {
      return res.status(502).json({ error: fetchErr.message });
    }
  }

  if (operation.error) {
    return res.json({ done: true, error: operation.error.message || 'Erro na gera\u00e7\u00e3o.' });
  }

  if (!operation.done) {
    return res.json({ done: false });
  }

  const videos =
    operation.result?.generatedVideos ||
    operation.response?.generatedVideos;

  if (!videos?.length) {
    return res.json({ done: true, error: 'Nenhum v\u00eddeo gerado. O prompt pode ter sido bloqueado.' });
  }

  const video = videos[0].video;

  res.json({
    done: true,
    videoName: video.name,
    videoUri: video.uri,
    mimeType: video.mimeType || 'video/mp4',
  });
});

// GET /api/video?name=... \u2014 baixa e serve o v\u00eddeo via Gemini Files API
app.get('/api/video', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'Par\u00e2metro "name" \u00e9 obrigat\u00f3rio.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY n\u00e3o configurada.' });
  }

  const downloadUrl =
    `https://generativelanguage.googleapis.com/v1beta/${name}?alt=media&key=${apiKey}`;

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    const body = await response.text();
    return res
      .status(response.status)
      .json({ error: `Falha ao baixar v\u00eddeo: ${body.slice(0, 200)}` });
  }

  const contentType = response.headers.get('content-type') || 'video/mp4';
  const contentLength = response.headers.get('content-length');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline; filename="video-gerado.mp4"');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  const buffer = await response.arrayBuffer();
  res.send(Buffer.from(buffer));
});

// GET /api/models \u2014 lista modelos dispon\u00edveis
app.get('/api/models', (_req, res) => {
  res.json(
    Object.entries(MODELS).map(([id, label]) => ({ id, label }))
  );
});

// Serve built frontend in production
const dist = path.join(__dirname, 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`\n\ud83c\udfac VideoStudio AI running on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('\n\u26a0\ufe0f  Configure GEMINI_API_KEY in .env to use the app.\n');
  }
});
