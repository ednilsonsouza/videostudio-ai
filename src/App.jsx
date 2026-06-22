import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ASPECT_RATIOS = [
  {
    id: '9:16',
    label: '9:16',
    description: 'Vertical',
    hint: 'Reels / TikTok / Shorts',
    pw: 36,
    ph: 64,
  },
  {
    id: '3:4',
    label: '3:4',
    description: 'Retrato',
    hint: 'Stories / Feed',
    pw: 48,
    ph: 64,
  },
  {
    id: '1:1',
    label: '1:1',
    description: 'Quadrado',
    hint: 'Instagram / Feed',
    pw: 56,
    ph: 56,
  },
  {
    id: '16:9',
    label: '16:9',
    description: 'Horizontal',
    hint: 'YouTube / Desktop',
    pw: 80,
    ph: 45,
  },
]

const DURATIONS = [4, 6, 8]

const DEFAULT_MODEL = 'veo-3.1-generate-preview'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ratioToNumber(id) {
  const map = { '9:16': 9 / 16, '3:4': 3 / 4, '1:1': 1, '16:9': 16 / 9 }
  return map[id] ?? 1
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Components ───────────────────────────────────────────────────────────────

function RatioButton({ ratio, selected, onSelect, disabled }) {
  return (
    <button
      className={`ratio-btn${selected ? ' active' : ''}`}
      onClick={() => onSelect(ratio.id)}
      disabled={disabled}
      title={ratio.hint}
    >
      <div
        className="ratio-shape"
        style={{ width: ratio.pw, height: ratio.ph }}
      />
      <span className="ratio-label">{ratio.label}</span>
      <span className="ratio-desc">{ratio.description}</span>
    </button>
  )
}

function ProgressBar({ progress, message }) {
  return (
    <div className="status-card">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress ?? 0}%` }} />
      </div>
      <p className="status-msg">{message || 'Processando...'}</p>
      <p className="status-hint">A geração demora aprox. 1–3 minutos</p>
    </div>
  )
}

// ─── Progress estimation based on elapsed time ────────────────────────────────

function estimateProgress(startedAt) {
  if (!startedAt) return 5
  const elapsed = (Date.now() - startedAt) / 1000 // seconds
  // Asymptotic curve: reaches ~85% at 3 min, never 100% until done
  const pct = 85 * (1 - Math.exp(-elapsed / 90))
  return Math.min(Math.round(5 + pct), 85)
}

function formatElapsed(startedAt) {
  if (!startedAt) return ''
  const s = Math.round((Date.now() - startedAt) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [duration, setDuration] = useState(8)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [models, setModels] = useState([])

  const [operationName, setOperationName] = useState(null)
  const [startedAt, setStartedAt] = useState(null)
  const [progress, setProgress] = useState(5)
  const [statusMsg, setStatusMsg] = useState('')
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoName, setVideoName] = useState(null)
  const [error, setError] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const pollRef = useRef(null)
  const progressRef = useRef(null)

  // Load models list
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then(setModels)
      .catch(() => {})
  }, [])

  const stopAll = useCallback(() => {
    if (pollRef.current)    { clearInterval(pollRef.current);    pollRef.current = null }
    if (progressRef.current){ clearInterval(progressRef.current); progressRef.current = null }
  }, [])

  const startPolling = useCallback(
    (opName, t0) => {
      stopAll()

      // Smooth progress ticker
      progressRef.current = setInterval(() => {
        setProgress(estimateProgress(t0))
        setStatusMsg(`Gerando vídeo... (${formatElapsed(t0)} decorrido)`)
      }, 1000)

      // Poll Gemini operation status every 8 seconds
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/status?op=${encodeURIComponent(opName)}`)
          if (!res.ok) return
          const data = await res.json()

          if (data.error) {
            stopAll()
            setError(data.error)
            setIsGenerating(false)
            return
          }

          if (data.done) {
            stopAll()
            setProgress(100)
            setStatusMsg('Vídeo pronto!')
            setVideoName(data.videoName)
            setVideoUrl(`/api/video?name=${encodeURIComponent(data.videoName)}`)
            setIsGenerating(false)
          }
        } catch {}
      }, 8000)
    },
    [stopAll]
  )

  useEffect(() => () => stopAll(), [stopAll])

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Digite um prompt para continuar.')
      return
    }

    setError(null)
    setVideoUrl(null)
    setVideoName(null)
    setOperationName(null)
    setProgress(5)
    setStatusMsg('Enviando para a API Gemini...')
    setIsGenerating(true)

    const t0 = Date.now()
    setStartedAt(t0)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
          durationSeconds: duration,
          model,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao iniciar geração.')
      }

      setOperationName(data.operationName)
      setStatusMsg('Geração iniciada, aguardando resultado...')
      startPolling(data.operationName, t0)
    } catch (err) {
      setError(err.message)
      setIsGenerating(false)
    }
  }

  const handleReset = () => {
    stopAll()
    setOperationName(null)
    setStartedAt(null)
    setProgress(5)
    setStatusMsg('')
    setVideoUrl(null)
    setVideoName(null)
    setError(null)
    setIsGenerating(false)
  }

  const currentRatio = ASPECT_RATIOS.find((r) => r.id === aspectRatio)
  const videoAspect = ratioToNumber(aspectRatio)

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-logo">
          <span className="header-icon">🎬</span>
          <div>
            <h1>VideoStudio AI</h1>
            <p>Powered by Google Gemini Veo 3</p>
          </div>
        </div>
        <div className="header-badge">
          <span className="badge-dot" />
          Veo 3 · Com Áudio
        </div>
      </header>

      <main className="main">
        {/* ── Left: Controls ── */}
        <div className="controls">
          <div className="card">
            {/* Prompt */}
            <div className="field">
              <label className="field-label">
                Prompt
                <span className="char-count">{prompt.length}/1000</span>
              </label>
              <textarea
                className="textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 1000))}
                placeholder="Descreva o vídeo que você quer criar...&#10;&#10;Ex: Um surfista em câmera lenta cortando uma onda gigante ao pôr do sol, qualidade cinematográfica"
                rows={5}
                disabled={isGenerating}
              />
              <p className="field-hint">
                Inclua detalhes de cena, iluminação, movimento de câmera e tom.
              </p>
            </div>

            {/* Aspect Ratio */}
            <div className="field">
              <label className="field-label">Proporção</label>
              <div className="ratio-grid">
                {ASPECT_RATIOS.map((r) => (
                  <RatioButton
                    key={r.id}
                    ratio={r}
                    selected={aspectRatio === r.id}
                    onSelect={setAspectRatio}
                    disabled={isGenerating}
                  />
                ))}
              </div>
              {(aspectRatio === '1:1' || aspectRatio === '3:4') && (
                <p className="field-warn">
                  ⚠️ A API Veo oficialmente suporta 9:16 e 16:9. As proporções {aspectRatio} podem resultar em erro.
                </p>
              )}
            </div>

            {/* Duration */}
            <div className="field">
              <label className="field-label">Duração</label>
              <div className="duration-row">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    className={`dur-btn${duration === d ? ' active' : ''}`}
                    onClick={() => setDuration(d)}
                    disabled={isGenerating}
                  >
                    {d}s
                  </button>
                ))}
              </div>
              <p className="field-hint">
                Máximo suportado pelo Veo é 8s. A duração real pode variar.
              </p>
            </div>

            {/* Model */}
            <div className="field">
              <label className="field-label">Modelo</label>
              <select
                className="select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isGenerating}
              >
                {models.length > 0 ? (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))
                ) : (
                  <option value={DEFAULT_MODEL}>Veo 3.1 (Com áudio)</option>
                )}
              </select>
              <p className="field-hint">
                Veo 3.x gera vídeo com áudio automático. Veo 2.0 não tem áudio.
              </p>
            </div>

            {/* CTA */}
            <button
              className="generate-btn"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? (
                <>
                  <span className="spinner" />
                  Gerando...
                </>
              ) : (
                <>✨ Gerar Vídeo</>
              )}
            </button>

            {error && (
              <div className="error-box">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Info card */}
          <div className="info-card">
            <h3>ℹ️ Como funciona</h3>
            <ul>
              <li>O Gemini Veo 3 gera vídeos com <strong>áudio nativo</strong></li>
              <li>A geração demora <strong>1–3 minutos</strong></li>
              <li>Veo é um recurso <strong>pago</strong> — requer API Key com billing ativo</li>
              <li>O vídeo fica disponível por <strong>2 dias</strong> na API do Google</li>
            </ul>
          </div>
        </div>

        {/* ── Right: Output ── */}
        <div className="output">
          {/* Idle state */}
          {!isGenerating && !videoUrl && (
            <div className="output-idle">
              <div className="idle-preview">
                <div
                  className="idle-shape"
                  style={{
                    aspectRatio: videoAspect,
                    maxWidth: aspectRatio === '9:16' ? 200 : aspectRatio === '3:4' ? 220 : 360,
                  }}
                />
              </div>
              <p className="idle-text">Seu vídeo aparecerá aqui</p>
              <p className="idle-ratio">
                {currentRatio?.label} — {currentRatio?.description}
              </p>
            </div>
          )}

          {/* Generating */}
          {isGenerating && (
            <ProgressBar progress={progress} message={statusMsg} />
          )}

          {/* Video Result */}
          {videoUrl && (
            <div className="result-card">
              <div className="result-header">
                <h2>Vídeo Gerado ✅</h2>
                <button className="reset-btn" onClick={handleReset}>
                  + Novo vídeo
                </button>
              </div>

              <div
                className="video-wrap"
                style={{
                  aspectRatio: videoAspect,
                  maxWidth:
                    aspectRatio === '9:16'
                      ? 320
                      : aspectRatio === '3:4'
                      ? 360
                      : '100%',
                  margin: '0 auto',
                }}
              >
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>

              <div className="result-actions">
                <a
                  href={videoUrl}
                  download="video-gerado.mp4"
                  className="download-btn"
                >
                  ⬇️ Baixar MP4
                </a>
              </div>

              <div className="result-meta">
                <span>Proporção: {aspectRatio}</span>
                <span>Duração: ~{duration}s</span>
                <span>Modelo: {model}</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
