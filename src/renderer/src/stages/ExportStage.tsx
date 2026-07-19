import { useEffect, useRef, useState } from 'react'
import {
  AudioInfo,
  DEFAULT_AV_OFFSET_SEC,
  ExportProgress,
  ExportResult,
  ProjectData,
  QUADRANT_LABELS,
  QUADRANTS,
  VOICE_LABELS,
  VOICE_PARTS,
  VoicePart
} from '@shared/types'
import { formatSeconds, toArrayBuffer } from '../util'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

const PREVIEW_SECONDS = 8

export default function ExportStage({ data, onData }: Props): React.JSX.Element {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null)
  const [offsetMs, setOffsetMs] = useState(
    Math.round((data.avOffsetSec ?? DEFAULT_AV_OFFSET_SEC) * 1000)
  )
  const [previewStart, setPreviewStart] = useState(30)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewStale, setPreviewStale] = useState(false)
  const commitTimer = useRef<number | null>(null)

  useEffect(() => {
    return window.api.onExportProgress(setProgress)
  }, [])

  useEffect(() => {
    window.api
      .getAudioInfo()
      .then((info) => {
        setAudioInfo(info)
        if (info) setPreviewStart((s) => Math.min(s, Math.max(0, Math.floor(info.durationSec / 3))))
      })
      .catch(() => setAudioInfo(null))
  }, [data.originalAudio])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const mappingValid = new Set(Object.values(data.quadrantMapping)).size === 4

  const setQuadrant = async (quadrant: (typeof QUADRANTS)[number], voice: VoicePart): Promise<void> => {
    const updated = await window.api.setQuadrantMapping({
      ...data.quadrantMapping,
      [quadrant]: voice
    })
    onData({ ...updated })
    setPreviewStale(true)
  }

  const changeOffset = (ms: number): void => {
    setOffsetMs(ms)
    setPreviewStale(true)
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(async () => {
      const updated = await window.api.setAvOffset(ms / 1000)
      onData({ ...updated })
    }, 300)
  }

  const renderPreview = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress({ phase: 'analyzing', progress: 0, message: 'Starting…' })
    try {
      // Make sure the latest slider value is saved before rendering.
      if (commitTimer.current !== null) {
        window.clearTimeout(commitTimer.current)
        commitTimer.current = null
        const updated = await window.api.setAvOffset(offsetMs / 1000)
        onData({ ...updated })
      }
      const res = await window.api.renderSyncPreview(previewStart, PREVIEW_SECONDS)
      const bytes = await window.api.readProjectFile(res.relPath)
      const blob = new Blob([toArrayBuffer(bytes)], { type: 'video/mp4' })
      setPreviewUrl(URL.createObjectURL(blob))
      setPreviewStale(false)
      setProgress(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress(null)
    } finally {
      setBusy(false)
    }
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

  const trackDuration = audioInfo?.durationSec ?? 0
  const maxPreviewStart = Math.max(0, Math.floor(trackDuration - PREVIEW_SECONDS))

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
        <h2>Sync check</h2>
        <p className="hint">
          Webcams deliver frames with some latency, so all four videos can lag the soundtrack by
          the same amount. The preview below is rendered by the <b>same pipeline as the export</b>{' '}
          (same alignment, same trims, small and fast) — what you see here is what the final video
          does. Adjust the slider until lips match the sound, then export.
        </p>
        <label className="field">
          Video timing: {offsetMs > 0 ? `${offsetMs} ms earlier` : offsetMs < 0 ? `${-offsetMs} ms later` : 'no adjustment'}
          <input
            type="range"
            min={-500}
            max={500}
            step={5}
            value={offsetMs}
            disabled={busy}
            onChange={(e) => changeOffset(Number(e.target.value))}
          />
          <span className="hint">
            Videos lag behind the music (most common) → move right. Videos come too early → move
            left.
          </span>
        </label>
        <label className="field">
          Preview from {formatSeconds(previewStart)}
          {trackDuration > 0 ? ` (track is ${formatSeconds(trackDuration)})` : ''}
          <input
            type="range"
            min={0}
            max={maxPreviewStart}
            step={1}
            value={Math.min(previewStart, maxPreviewStart)}
            disabled={busy}
            onChange={(e) => {
              setPreviewStart(Number(e.target.value))
              setPreviewStale(true)
            }}
          />
        </label>
        <div className="row">
          <button className="secondary" onClick={renderPreview} disabled={busy || !mappingValid}>
            {busy ? 'Working…' : `▶ Render ${PREVIEW_SECONDS} s sync preview`}
          </button>
          {previewUrl && previewStale && (
            <span className="warn-text">Settings changed — render again to hear the result.</span>
          )}
        </div>
        {previewUrl && (
          <div className="preview-frame">
            <video src={previewUrl} controls autoPlay loop />
          </div>
        )}
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
            <p className="hint">
              {result.audioAction === 'copied'
                ? `Soundtrack copied bit-exact from the imported ${result.audioCodec} file — no re-encoding, no quality change.`
                : `Soundtrack encoded once from the ${result.audioCodec} source to AAC 320 kbit/s.`}
            </p>
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
