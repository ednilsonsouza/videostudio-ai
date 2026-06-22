import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  const { op } = req.query;
  if (!op) {
    return res.status(400).json({ error: 'Parâmetro "op" (operationName) é obrigatório.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
  }

  let operation;

  // Try SDK first, fall back to raw REST API
  try {
    const ai = new GoogleGenAI({ apiKey });
    operation = await ai.operations.get({ operation: { name: op } });
  } catch {
    // Direct REST call to Gemini Operations API
    // op can be "operations/xxx" or a full path
    const opPath = op.startsWith('http') ? new URL(op).pathname.replace(/^\//, '') : op;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${opPath}?key=${apiKey}`
    );
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `Erro na operação: ${body.slice(0, 200)}` });
    }
    operation = await r.json();
  }

  if (operation.error) {
    return res.json({ done: true, error: operation.error.message || 'Erro na geração.' });
  }

  if (!operation.done) {
    return res.json({ done: false });
  }

  // Extract generated video
  const videos =
    operation.result?.generatedVideos ||
    operation.response?.generatedVideos;

  if (!videos?.length) {
    return res.json({ done: true, error: 'Nenhum vídeo gerado. O prompt pode ter sido bloqueado.' });
  }

  const video = videos[0].video;

  res.json({
    done: true,
    videoName: video.name,   // "files/xxxx"
    videoUri:  video.uri,    // full Gemini Files URI
    mimeType:  video.mimeType || 'video/mp4',
  });
}
