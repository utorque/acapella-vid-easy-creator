import { useCallback, useEffect, useRef, useState } from 'react'
import { ProjectData, VOICE_LABELS, VOICE_PARTS, VoicePart } from '@shared/types'
import { RecordingHandle, startTakeRecording, TakeRecording } from '../audio/capture'
import { formatSeconds, readProjectAudioBuffer } from '../util'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

type Mode = 'idle' | 'recording' | 'reviewing'

export default function CaptureStage({ data, onData }: Props): React.JSX.Element {
  const [voice, setVoice] = useState<VoicePart>(
    VOICE_PARTS.find((v) => !data.takes[v]) ?? 'tenor'
  )
  const [mode, setMode] = useState<Mode>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string>('')
  const [micId, setMicId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)

  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const pickupBufferRef = useRef<AudioBuffer | null>(null)
  const recordingRef = useRef<RecordingHandle | null>(null)
  const takeRef = useRef<TakeRecording | null>(null)
  const timerRef = useRef<number | null>(null)

  const stopStream = useCallback((): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const openStream = useCallback(async (): Promise<MediaStream> => {
    stopStream()
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        deviceId: micId ? { exact: micId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
    streamRef.current = stream
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = stream
      await previewVideoRef.current.play().catch(() => undefined)
    }
    return stream
  }, [cameraId, micId, stopStream])

  // Open the preview and enumerate devices on mount / device change.
  useEffect(() => {
    let cancelled = false
    setError(null)
    openStream()
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((list) => {
        if (!cancelled) setDevices(list)
      })
      .catch((e) => {
        if (!cancelled) setError(`Camera/microphone unavailable: ${e.message ?? e}`)
      })
    return () => {
      cancelled = true
    }
  }, [openStream])

  // Full teardown on unmount only.
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel()
      stopStream()
      ctxRef.current?.close()
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [stopStream])

  useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    }
  }, [reviewUrl])

  const getCtx = (): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  const loadPickup = async (): Promise<AudioBuffer> => {
    if (!data.pickupAudio) throw new Error('No pickup track — generate the count-in first')
    if (!pickupBufferRef.current) {
      pickupBufferRef.current = await readProjectAudioBuffer(getCtx(), data.pickupAudio)
    }
    return pickupBufferRef.current
  }

  const stopRecording = useCallback(async (): Promise<void> => {
    const rec = recordingRef.current
    if (!rec) return
    recordingRef.current = null
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    try {
      const take = await rec.stop()
      takeRef.current = take
      setReviewUrl(URL.createObjectURL(take.blob))
      setMode('reviewing')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setMode('idle')
    }
  }, [])

  const record = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const pickup = await loadPickup()
      const stream = streamRef.current ?? (await openStream())
      const videoTrack = stream.getVideoTracks()[0]
      const audioTracks = stream.getAudioTracks()
      if (!videoTrack) throw new Error('No camera track available')
      if (audioTracks.length === 0) throw new Error('No microphone track available')
      const rec = await startTakeRecording({
        ctx: getCtx(),
        videoTrack,
        micStream: new MediaStream(audioTracks),
        guideBuffer: pickup,
        onGuideEnded: () => {
          // Track finished — stop automatically a moment later.
          window.setTimeout(() => stopRecording(), 500)
        }
      })
      recordingRef.current = rec
      setElapsed(0)
      const startedAt = Date.now()
      timerRef.current = window.setInterval(
        () => setElapsed((Date.now() - startedAt) / 1000),
        250
      )
      setMode('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const acceptTake = async (): Promise<void> => {
    const take = takeRef.current
    if (!take) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await take.blob.arrayBuffer())
      const updated = await window.api.saveTake(voice, bytes, take.scheduledOffsetSec)
      onData({ ...updated })
      discardReview()
      // Jump to the next missing part, if any.
      const next = VOICE_PARTS.find((v) => v !== voice && !updated.takes[v])
      if (next) setVoice(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const discardReview = (): void => {
    takeRef.current = null
    if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    setReviewUrl(null)
    setMode('idle')
    // Resume the live preview.
    if (previewVideoRef.current && streamRef.current) {
      previewVideoRef.current.srcObject = streamRef.current
      previewVideoRef.current.play().catch(() => undefined)
    }
  }

  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')

  return (
    <div className="stage wide">
      <h2>Capture</h2>
      <p className="hint">
        Wear headphones so the guide track does not bleed into the microphone. Recording starts
        the count-in automatically — sync is measured, not guessed, so just sing.
      </p>
      <div className="capture-layout">
        <div>
          <div className={`video-frame ${mode === 'recording' ? 'recording' : ''}`}>
            {mode === 'reviewing' && reviewUrl ? (
              <video src={reviewUrl} controls autoPlay />
            ) : (
              <video ref={previewVideoRef} muted playsInline />
            )}
            {mode === 'recording' && <div className="rec-badge">REC {formatSeconds(elapsed)}</div>}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {mode === 'idle' && (
              <button className="primary" onClick={record} disabled={busy || !data.pickupAudio}>
                ● Record {VOICE_LABELS[voice]}
              </button>
            )}
            {mode === 'recording' && (
              <button className="danger" onClick={() => stopRecording()}>
                ■ Stop
              </button>
            )}
            {mode === 'reviewing' && (
              <>
                <button className="primary" onClick={acceptTake} disabled={busy}>
                  ✓ Accept take
                </button>
                <button className="secondary" onClick={discardReview} disabled={busy}>
                  ↺ Re-record
                </button>
              </>
            )}
          </div>
        </div>
        <div className="card">
          <h2>Voice part</h2>
          <div className="voice-list">
            {VOICE_PARTS.map((v) => (
              <div
                key={v}
                className={`voice-item ${v === voice ? 'selected' : ''}`}
                onClick={() => mode === 'idle' && setVoice(v)}
              >
                <span>{VOICE_LABELS[v]}</span>
                <span className={`voice-status ${data.takes[v] ? 'done' : ''}`}>
                  {data.takes[v] ? '✓ recorded' : 'missing'}
                </span>
              </div>
            ))}
          </div>
          <label className="field">
            Camera
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              <option value="">Default</option>
              {cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Camera'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Microphone
            <select value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">Default</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Microphone'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
