import { useEffect, useState } from 'react'
import { AudioInfo, ProjectData } from '@shared/types'

interface Props {
  projectDir: string | null
  data: ProjectData | null
  onProject: (dir: string, data: ProjectData) => void
  onData: (data: ProjectData) => void
}

export default function ProjectStage({ projectDir, data, onProject, onData }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null)

  useEffect(() => {
    if (!data?.originalAudio) {
      setAudioInfo(null)
      return
    }
    let cancelled = false
    window.api
      .getAudioInfo()
      .then((info) => {
        if (!cancelled) setAudioInfo(info)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [data?.originalAudio])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stage">
      <h2>Project</h2>
      <div className="card">
        <div className="row">
          <label className="field">
            New project name
            <input
              type="text"
              value={name}
              placeholder="e.g. sweet-adeline"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() =>
              run(async () => {
                const result = await window.api.createProject(name)
                if (result) onProject(result.dir, result.data)
              })
            }
          >
            Create project…
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await window.api.openProject()
                if (result) onProject(result.dir, result.data)
              })
            }
          >
            Open existing…
          </button>
        </div>
        {projectDir && (
          <p className="hint mono">
            Project folder: {projectDir}
          </p>
        )}
      </div>

      {data && (
        <div className="card">
          <h2>Mixed audio track</h2>
          <p className="hint">
            Import the final mixed track (the full arrangement you will sing along to). Audio
            mixing itself happens outside this app.
          </p>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const updated = await window.api.importAudio()
                  if (updated) onData({ ...updated })
                })
              }
            >
              {data.originalAudio ? 'Replace track…' : 'Import track…'}
            </button>
            {data.originalAudio && <span className="ok-text mono">✓ {data.originalAudio}</span>}
          </div>
          {audioInfo && (
            <p className="hint mono">
              {audioInfo.codec} · {(audioInfo.sampleRate / 1000).toFixed(1)} kHz ·{' '}
              {audioInfo.channels === 1 ? 'mono' : 'stereo'}
              {audioInfo.bitrateKbps > 0 && !audioInfo.lossless
                ? ` · ${audioInfo.bitrateKbps} kbit/s`
                : ''}
              {audioInfo.lossless ? ' · lossless' : ''}
            </p>
          )}
          {audioInfo && !audioInfo.lossless && audioInfo.willCopy && (
            <p className="hint">
              This file is already lossy-compressed. It will be placed in the final video
              byte-for-byte (never re-encoded), so the export sounds exactly like this file — if
              you hear compression noise in it, export a WAV/FLAC mix instead.
            </p>
          )}
          {audioInfo && !audioInfo.lossless && !audioInfo.willCopy && (
            <p className="warn-text">
              This file is lossy-compressed in a format MP4 can't carry, so the export has to
              re-encode it (quality loss stacks). For best quality import a WAV/FLAC — or MP3/M4A —
              mix instead.
            </p>
          )}
          {data.originalAudio && !data.pickupAudio && (
            <p className="hint">Next: generate the count-in in step 2.</p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
