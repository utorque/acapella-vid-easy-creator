import { useEffect, useState } from 'react'
import {
  ColorAnalysisResult,
  ColorPreviewSample,
  ExportProgress,
  ProjectData,
  QUADRANT_LABELS,
  QUADRANTS,
  VOICE_LABELS,
  VoicePart
} from '@shared/types'
import { computeColorSourceKey } from '@shared/colorKey'
import { formatSeconds, toArrayBuffer } from '../util'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

type Phase = 'idle' | 'analyzing' | 'reviewing' | 'summary'

export default function ColorStage({ data, onData }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>(data.colorCorrection ? 'summary' : 'idle')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ColorAnalysisResult | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map())
  const [sliderIndex, setSliderIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.api.onColorProgress(setProgress), [])

  // Revoke each thumbnail batch's object URLs when replaced or on unmount.
  useEffect(() => {
    return () => {
      for (const url of thumbUrls.values()) URL.revokeObjectURL(url)
    }
  }, [thumbUrls])

  const stale =
    !!data.colorCorrection && data.colorCorrection.sourceKey !== computeColorSourceKey(data)

  const startAnalyze = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setPhase('analyzing')
    setProgress({ phase: 'analyzing', progress: 0, message: 'Starting…' })
    try {
      const res = await window.api.analyzeColor()
      const relPaths = new Set<string>()
      for (const s of res.samples) {
        for (const p of Object.values(s.before)) if (p) relPaths.add(p)
        for (const p of Object.values(s.after)) if (p) relPaths.add(p)
      }
      const urls = new Map<string, string>()
      await Promise.all(
        [...relPaths].map(async (relPath) => {
          const bytes = await window.api.readProjectFile(relPath)
          urls.set(relPath, URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: 'image/png' })))
        })
      )
      setThumbUrls(urls)
      setResult(res)
      setSliderIndex(0)
      setPhase('reviewing')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase(data.colorCorrection ? 'summary' : 'idle')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const apply = async (): Promise<void> => {
    if (!result) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.api.applyColorCorrection(result.correction)
      onData({ ...updated })
      setSaved(true)
      setPhase('summary')
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const skip = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const updated = await window.api.skipColorCorrection()
      onData({ ...updated })
      setPhase('summary')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const renderGrid = (sample: ColorPreviewSample, side: 'before' | 'after'): React.JSX.Element => (
    <div className="color-grid">
      {QUADRANTS.map((q) => {
        const voice: VoicePart = data.quadrantMapping[q]
        const relPath = sample[side][voice]
        const url = relPath ? thumbUrls.get(relPath) : undefined
        return (
          <div key={q} className="color-cell" title={`${QUADRANT_LABELS[q]} — ${VOICE_LABELS[voice]}`}>
            {url ? <img src={url} alt={VOICE_LABELS[voice]} /> : <div className="color-cell-empty" />}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="stage wide">
      <div className="stage-head">
        <h2>Color consistency</h2>
        <button className="secondary" onClick={skip} disabled={busy}>
          Skip →
        </button>
      </div>
      <p className="hint">
        Measures the mean color and brightness inside the crop region of each take, then computes a
        gentle correction that pulls every take toward the shared average — tracking lighting drift
        over the course of each recording, not just a single flat offset.
      </p>
      {stale && (
        <p className="warn-text">
          Crop, takes, or timing changed since this was last analyzed — re-analyze to keep the
          correction accurate.
        </p>
      )}

      {phase === 'summary' && data.colorCorrection && (
        <div className="card">
          {data.colorCorrection.status === 'applied' ? (
            <p className="ok-text">✓ Color correction applied.</p>
          ) : (
            <p className="hint">Color correction skipped — takes will export unmodified.</p>
          )}
          <div className="row">
            <button className="secondary" onClick={startAnalyze} disabled={busy}>
              Re-analyze
            </button>
          </div>
        </div>
      )}

      {phase === 'idle' && (
        <div className="card">
          <button className="primary" onClick={startAnalyze} disabled={busy}>
            Analyze color consistency
          </button>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="card">
          <p className="hint">{progress?.message ?? 'Working…'}</p>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {phase === 'reviewing' && result && (
        <div className="card">
          <label className="field">
            Sample {sliderIndex + 1} / {result.samples.length} · at{' '}
            {formatSeconds(result.samples[sliderIndex].tSec)}
            <input
              type="range"
              min={1}
              max={result.samples.length}
              value={sliderIndex + 1}
              onChange={(e) => setSliderIndex(Number(e.target.value) - 1)}
            />
          </label>
          <div className="color-compare">
            <div>
              <p className="color-compare-label">Original</p>
              {renderGrid(result.samples[sliderIndex], 'before')}
            </div>
            <div>
              <p className="color-compare-label">Corrected</p>
              {renderGrid(result.samples[sliderIndex], 'after')}
            </div>
          </div>
          <div className="row">
            <button className="primary" onClick={apply} disabled={busy}>
              Apply correction
            </button>
            {saved && <span className="ok-text">✓ Saved</span>}
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
