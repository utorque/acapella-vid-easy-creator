import { useEffect, useRef, useState } from 'react'
import { ProjectData } from '@shared/types'
import {
  audioBufferToWav,
  COUNT_IN_FILE_RATE,
  countInDurationSec,
  previewCountIn,
  PreviewHandle,
  renderCountIn
} from '../audio/countin'
import { readProjectAudioBuffer } from '../util'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

export default function PickupStage({ data, onData }: Props): React.JSX.Element {
  const [bpm, setBpm] = useState(data.countIn?.bpm ?? 100)
  const [beats, setBeats] = useState(data.countIn?.beats ?? 4)
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const previewRef = useRef<PreviewHandle | null>(null)
  const trackBufferRef = useRef<AudioBuffer | null>(null)

  useEffect(() => {
    return () => {
      previewRef.current?.stop()
      ctxRef.current?.close()
    }
  }, [])

  const getCtx = (): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  const loadTrack = async (): Promise<AudioBuffer> => {
    if (!data.originalAudio) throw new Error('No track imported')
    if (!trackBufferRef.current) {
      trackBufferRef.current = await readProjectAudioBuffer(getCtx(), data.originalAudio)
    }
    return trackBufferRef.current
  }

  const stopPreview = (): void => {
    previewRef.current?.stop()
    previewRef.current = null
    setPreviewing(false)
  }

  const preview = async (): Promise<void> => {
    setError(null)
    try {
      const ctx = getCtx()
      if (ctx.state !== 'running') await ctx.resume()
      const track = await loadTrack()
      // Render at the playback context's rate — a rate mismatch would make
      // AudioBufferSourceNode linear-resample, which adds audible aliasing.
      const countIn = await renderCountIn(bpm, beats, ctx.sampleRate)
      stopPreview()
      setPreviewing(true)
      previewRef.current = previewCountIn(ctx, countIn, track, 8, () => setPreviewing(false))
    } catch (e) {
      setPreviewing(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const accept = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    stopPreview()
    try {
      const countIn = await renderCountIn(bpm, beats, COUNT_IN_FILE_RATE)
      const wav = audioBufferToWav(countIn)
      const updated = await window.api.acceptCountIn(wav, {
        bpm,
        beats,
        durationSec: countInDurationSec(bpm, beats)
      })
      onData({ ...updated })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const durationSec = countInDurationSec(bpm, beats)

  return (
    <div className="stage">
      <h2>Count-in</h2>
      <p className="hint">
        The count-in is prepended to the track during capture so you know exactly when singing
        starts. The final export uses the clean track without it.
      </p>
      <div className="card">
        <label className="field">
          Tempo: {bpm} BPM (count-in lasts {durationSec.toFixed(2)} s)
          <input
            type="range"
            min={40}
            max={208}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </label>
        <label className="field">
          Beats
          <select value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
            <option value={2}>2 clicks</option>
            <option value={4}>4 clicks</option>
            <option value={8}>8 clicks</option>
          </select>
        </label>
        <div className="row">
          {!previewing ? (
            <button className="secondary" onClick={preview} disabled={busy}>
              ▶ Preview count-in + track start
            </button>
          ) : (
            <button className="secondary" onClick={stopPreview}>
              ■ Stop preview
            </button>
          )}
          <button className="primary" onClick={accept} disabled={busy}>
            {busy ? 'Generating…' : 'Accept — generate pickup track'}
          </button>
        </div>
        {data.pickupAudio && data.countIn && (
          <p className="ok-text">
            ✓ Pickup track generated ({data.countIn.beats} clicks at {data.countIn.bpm} BPM,{' '}
            {data.countIn.durationSec.toFixed(2)} s). Re-accept to overwrite.
          </p>
        )}
        {data.pickupAudio && Object.keys(data.takes).length > 0 && (
          <p className="warn-text">
            Takes were recorded against the current pickup track. If you change the count-in,
            re-record all takes.
          </p>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
