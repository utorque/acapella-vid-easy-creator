import { useEffect, useState } from 'react'
import { AudioInfo, ProjectData, VOICE_LABELS, VOICE_PARTS, VoicePart } from '@shared/types'

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
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

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

  const runVoiceImport = async (fn: () => Promise<void>): Promise<void> => {
    setVoiceBusy(true)
    setVoiceError(null)
    try {
      await fn()
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : String(e))
    } finally {
      setVoiceBusy(false)
    }
  }

  const browseVoiceAudio = (): void => {
    if (voiceBusy) return
    void runVoiceImport(async () => {
      const updated = await window.api.importVoiceAudioDialog()
      if (updated) onData({ ...updated })
    })
  }

  const onVoiceDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    void runVoiceImport(async () => {
      const paths = files.map((f) => window.api.getPathForFile(f))
      const updated = await window.api.importVoiceAudioPaths(paths)
      onData({ ...updated })
    })
  }

  const removeVoiceAudio = (voice: VoicePart): void => {
    void runVoiceImport(async () => {
      const updated = await window.api.deleteVoiceAudio(voice)
      onData({ ...updated })
    })
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

      {data?.originalAudio && (
        <div className="card">
          <h2>Per-voice reference audio (optional)</h2>
          <p className="hint">
            Add the four individual voice stems to see a waveform of your own part while
            recording it, with a bar that tracks it in exact sync with the full mix. Name each
            file with "ten", "lead", "bari" or "bass" so it's matched to the right voice, and make
            sure each one is the same length as the mixed track above.
          </p>
          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onClick={browseVoiceAudio}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onVoiceDrop}
          >
            {voiceBusy ? 'Importing…' : 'Drop voice files here, or click to browse…'}
          </div>
          <div className="voice-list">
            {VOICE_PARTS.map((v) => (
              <div key={v} className="voice-item" style={{ cursor: 'default' }}>
                <span>{VOICE_LABELS[v]}</span>
                {data.voiceAudio?.[v] ? (
                  <span className="row" style={{ gap: 8 }}>
                    <span className="voice-status done">✓ {data.voiceAudio[v]}</span>
                    <button
                      className="danger"
                      disabled={voiceBusy}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeVoiceAudio(v)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="voice-status">not uploaded</span>
                )}
              </div>
            ))}
          </div>
          {voiceError && <p className="error">{voiceError}</p>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
