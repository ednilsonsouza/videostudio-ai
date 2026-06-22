export default function handler(req, res) {
  res.json([
    { id: 'veo-3.1-generate-preview',      label: 'Veo 3.1 — Melhor qualidade (Com áudio)' },
    { id: 'veo-3.1-fast-generate-preview',  label: 'Veo 3.1 Fast — Mais rápido (Com áudio)' },
    { id: 'veo-3.1-lite-generate-preview',  label: 'Veo 3.1 Lite — Mais barato (Com áudio)' },
    { id: 'veo-2.0-generate-001',           label: 'Veo 2.0 — Sem áudio' },
  ]);
}
