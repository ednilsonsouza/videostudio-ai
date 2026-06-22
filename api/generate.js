import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
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

  const ai = new GoogleGenAI({ apiKey });

  // Starts the long-running operation and returns immediately with the operation name.
  // The actual video generation happens asynchronously on Google's servers.
  const operation = await ai.models.generateVideos({
    model,
    prompt: prompt.trim(),
    config: {
      aspectRatio,
      durationSeconds: Number(durationSeconds),
    },
  });

  res.json({ operationName: operation.name });
}
