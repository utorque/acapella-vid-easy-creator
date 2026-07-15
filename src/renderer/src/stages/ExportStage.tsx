import { useEffect, useState } from 'react'
import {
  ExportProgress,
  ExportResult,
  ProjectData,
  QUADRANT_LABELS,
  QUADRANTS,
  VOICE_LABELS,
  VOICE_PARTS,
  VoicePart
} from '@shared/types'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

export default function ExportStage({ data, onData }: Props): React.JSX.Element {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return window.api.onExportProgress(setProgress)
  }, [])

  const mappingValid = new Set(Object.values(data.quadrantMapping)).size === 4

  const setQuadrant = async (quadrant: (typeof QUADRANTS)[number], voice: VoicePart): Promise<void> => {
    const updated = await window.api.setQuadrantMapping({
      ...data.quadrantMapping,
      [quadrant]: voice
    })
    onData({ ...updated })
  }

  const runExport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress({ phase: 'analyzing', progress: 0, message: 'Starting…' })
    try {
      const res = await window.api.exportVideo()
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stage">
      <h2>Export</h2>
      <p className="hint">
        Each take is aligned by locating the recorded guide track inside it (cross-correlation),
        cropped, assembled into a 2×2 grid, and laid over the clean mixed track.
      </p>

      <div className="card">
        <h2>Quadrant layout</h2>
        <div className="quad-grid">
          {QUADRANTS.map((q) => (
            <div key={q} className="quad-cell">
              <span className="hint">{QUADRANT_LABELS[q]}</span>
              <select
                value={data.quadrantMapping[q]}
                disabled={busy}
                onChange={(e) => setQuadrant(q, e.target.value as VoicePart)}
              >
                {VOICE_PARTS.map((v) => (
                  <option key={v} value={v}>
                    {VOICE_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {!mappingValid && <p className="error">Each voice part must appear in exactly one quadrant.</p>}
      </div>

      <div className="card">
        <div className="row">
          <button className="primary" onClick={runExport} disabled={busy || !mappingValid}>
            {busy ? 'Exporting…' : 'Export final video'}
          </button>
          {result && (
            <button
              className="secondary"
              onClick={() => window.api.showItemInFolder(result.outPath)}
            >
              Show in folder
            </button>
          )}
        </div>
        {progress && progress.phase !== 'done' && (
          <>
            <p className="hint">{progress.message}</p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
          </>
        )}
        {result && (
          <>
            <p className="ok-text">✓ Exported: {result.outPath}</p>
            <table className="offsets">
              <thead>
                <tr>
                  <th>Voice</th>
                  <th>Guide found at</th>
                  <th>Singing starts at</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {result.offsets.map((o) => (
                  <tr key={o.voice} className="mono">
                    <td>{VOICE_LABELS[o.voice]}</td>
                    <td>{o.offsetSec.toFixed(3)} s</td>
                    <td>{o.singingStartSec.toFixed(3)} s</td>
                    <td>{(o.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
