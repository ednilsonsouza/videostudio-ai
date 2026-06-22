export default async function handler(req, res) {
  const { name } = req.query; // e.g. "files/xxxx"
  if (!name) {
    return res.status(400).json({ error: 'Parâmetro "name" é obrigatório.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
  }

  const downloadUrl =
    `https://generativelanguage.googleapis.com/v1beta/${name}?alt=media&key=${apiKey}`;

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    const body = await response.text();
    return res
      .status(response.status)
      .json({ error: `Falha ao baixar vídeo: ${body.slice(0, 200)}` });
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
}
