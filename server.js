import express from 'express';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS for dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Ensure tmp directory exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

if (!process.env.GEMINI_API_KEY) {
  console.error('⚠️  GEMINI_API_KEY not found in .env file');
  console.error('   Create a .env file with: GEMINI_API_KEY=your_key_here');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Job store (in-memory)
const jobs = new Map();
let jobCounter = 0;

// Supported Veo models via Gemini Developer API (v1beta)
const MODELS = {
  'veo-3.1-generate-preview': 'Veo 3.1 — Melhor qualidade (Com áudio)',
  'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast — Mais rápido (Com áudio)',
  'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite — Mais barato (Com áudio)',
  'veo-2.0-generate-001': 'Veo 2.0 — Sem áudio',
};

// POST /api/generate — start video generation
app.post('/api/generate', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada. Crie um arquivo .env com sua chave.' });
  }

  const {
    prompt,
    aspectRatio = '9:16',
    durationSeconds = 8,
    model = 'veo-3.1-generate-preview',
  } = req.body;

  if (!prompt?.trim()) {
    return res.status(400).json({ error: 'Prompt é obrigatório.' });
  }

  const jobId = `job_${Date.now()}_${jobCounter++}`;
  jobs.set(jobId, { status: 'starting', progress: 5, message: 'Iniciando geração...' });

  // Fire-and-forget async generation
  runGeneration(jobId, prompt.trim(), aspectRatio, durationSeconds, model).catch((err) => {
    console.error(`[${jobId}] Generation error:`, err.message);
    jobs.set(jobId, { status: 'error', error: err.message });
  });

  res.json({ jobId });
});

async function runGeneration(jobId, prompt, aspectRatio, durationSeconds, model) {
  try {
    jobs.set(jobId, { status: 'generating', progress: 10, message: 'Enviando para a API Gemini...' });

    const config = {
      aspectRatio,
      durationSeconds: Number(durationSeconds),
    };

    let operation = await ai.models.generateVideos({
      model,
      prompt,
      config,
    });

    jobs.set(jobId, { status: 'generating', progress: 15, message: 'Geração em andamento...' });

    const maxAttempts = 72; // 72 * 15s = 18 minutes max
    let attempts = 0;

    while (!operation.done && attempts < maxAttempts) {
      await sleep(15000);
      attempts++;

      try {
        operation = await ai.operations.get({ operation });
      } catch (pollErr) {
        // Some SDK versions use different signature
        try {
          operation = await ai.operations.get(operation);
        } catch {
          throw pollErr;
        }
      }

      const progress = Math.min(15 + Math.round((attempts / maxAttempts) * 65), 80);
      const elapsed = attempts * 15;
      jobs.set(jobId, {
        status: 'generating',
        progress,
        message: `Gerando vídeo... (${formatTime(elapsed)} decorrido)`,
      });
    }

    if (!operation.done) {
      throw new Error('Timeout: a geração demorou mais de 18 minutos.');
    }

    jobs.set(jobId, { status: 'downloading', progress: 85, message: 'Baixando vídeo...' });

    // Extract video from response (handle both .result and .response for compatibility)
    const generatedVideos =
      operation.result?.generatedVideos ||
      operation.response?.generatedVideos;

    if (!generatedVideos?.length) {
      const reason = operation.error?.message || 'Nenhum vídeo foi gerado. O prompt pode ter sido bloqueado por políticas de segurança.';
      throw new Error(reason);
    }

    const videoObj = generatedVideos[0].video;
    const videoUri = videoObj?.uri;
    const videoName = videoObj?.name; // e.g. "files/xxxxx"

    if (!videoUri && !videoName) {
      throw new Error('Resposta da API não contém URI do vídeo.');
    }

    // Build download URL
    const apiKey = process.env.GEMINI_API_KEY;
    let downloadUrl;

    if (videoUri) {
      // The URI from Gemini Files API needs ?alt=media to get the bytes
      const u = new URL(videoUri.startsWith('http') ? videoUri : `https://generativelanguage.googleapis.com/v1beta/${videoName}`);
      u.searchParams.set('alt', 'media');
      u.searchParams.set('key', apiKey);
      downloadUrl = u.toString();
    } else {
      downloadUrl = `https://generativelanguage.googleapis.com/v1beta/${videoName}?alt=media&key=${apiKey}`;
    }

    const response = await fetch(downloadUrl);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Falha ao baixar vídeo: ${response.status} — ${body.slice(0, 200)}`);
    }

    const buffer = await response.arrayBuffer();
    const videoPath = path.join(tmpDir, `${jobId}.mp4`);
    fs.writeFileSync(videoPath, Buffer.from(buffer));

    jobs.set(jobId, {
      status: 'done',
      progress: 100,
      message: 'Vídeo pronto!',
      videoPath,
      mimeType: videoObj?.mimeType || 'video/mp4',
      aspectRatio,
    });

    // Auto-cleanup after 2 hours
    setTimeout(() => {
      try {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        jobs.delete(jobId);
      } catch {}
    }, 7200000);

    console.log(`[${jobId}] Done — ${videoPath}`);
  } catch (err) {
    jobs.set(jobId, { status: 'error', error: err.message });
    throw err;
  }
}

// GET /api/status/:jobId
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job não encontrado.' });
  // Don't expose the file path
  const { videoPath, ...safeJob } = job;
  res.json(safeJob);
});

// GET /api/video/:jobId — stream video
app.get('/api/video/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Vídeo não está pronto.' });
  }

  const { videoPath, mimeType } = job;
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Arquivo de vídeo não encontrado.' });
  }

  const stat = fs.statSync(videoPath);
  res.setHeader('Content-Type', mimeType || 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', 'inline; filename="video-gerado.mp4"');
  res.setHeader('Accept-Ranges', 'bytes');

  fs.createReadStream(videoPath).pipe(res);
});

// GET /api/models — list available models
app.get('/api/models', (req, res) => {
  res.json(
    Object.entries(MODELS).map(([id, label]) => ({ id, label }))
  );
});

// Serve built frontend in production
const dist = path.join(__dirname, 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`\n🎬 VideoStudio AI rodando em http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   Frontend (dev): http://localhost:5173`);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.log('\n⚠️  Configure GEMINI_API_KEY no arquivo .env para usar o app.\n');
  }
});

// Helpers
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
