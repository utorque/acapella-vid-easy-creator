import { useEffect, useMemo, useRef, useState } from 'react'
import { CropRect, ProjectData, VOICE_LABELS, VOICE_PARTS, VoicePart } from '@shared/types'
import CropOverlay from '../components/CropOverlay'
import { toArrayBuffer } from '../util'

interface Props {
  data: ProjectData
  onData: (data: ProjectData) => void
}

const DISPLAY_WIDTH = 800

export default function CropStage({ data, onData }: Props): React.JSX.Element {
  const recordedVoices = useMemo(
    () => VOICE_PARTS.filter((v) => !!data.takes[v]),
    [data.takes]
  )
  const [previewVoice, setPreviewVoice] = useState<VoicePart>(recordedVoices[0])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null)
  const [displayRect, setDisplayRect] = useState<CropRect | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const take = data.takes[previewVoice]

  // Load the selected take into a blob URL for frame display.
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setVideoUrl(null)
    setVideoDims(null)
    setError(null)
    if (!take) return
    window.api
      .readProjectFile(take.file)
      .then((bytes) => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: 'video/webm' }))
        setVideoUrl(url)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [take])

  const onMetadata = (): void => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    setVideoDims({ w: v.videoWidth, h: v.videoHeight })
    v.currentTime = Math.min(1, v.duration / 2 || 0)
  }

  const scale = videoDims ? DISPLAY_WIDTH / videoDims.w : 1
  const displayHeight = videoDims ? Math.round(videoDims.h * scale) : 0

  // Initialize the display rect from the saved crop (or a centered default).
  useEffect(() => {
    if (!videoDims || displayRect) return
    if (data.crop) {
      setDisplayRect({
        x: data.crop.x * scale,
        y: data.crop.y * scale,
        size: data.crop.size * scale
      })
    } else {
      const size = Math.min(DISPLAY_WIDTH, displayHeight) * 0.8
      setDisplayRect({
        x: (DISPLAY_WIDTH - size) / 2,
        y: (displayHeight - size) / 2,
        size
      })
    }
  }, [videoDims, displayRect, data.crop, scale, displayHeight])

  const save = async (): Promise<void> => {
    if (!displayRect || !videoDims) return
    setBusy(true)
    setError(null)
    try {
      const crop: CropRect = {
        x: Math.round(displayRect.x / scale),
        y: Math.round(displayRect.y / scale),
        size: Math.round(displayRect.size / scale)
      }
      // Keep the crop inside the source frame after rounding.
      crop.size = Math.min(crop.size, videoDims.w, videoDims.h)
      crop.x = Math.max(0, Math.min(crop.x, videoDims.w - crop.size))
      crop.y = Math.max(0, Math.min(crop.y, videoDims.h - crop.size))
      const updated = await window.api.setCrop(crop)
      onData({ ...updated })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!take) {
    return (
      <div className="stage">
        <h2>Crop</h2>
        <p className="hint">Record at least one take first.</p>
      </div>
    )
  }

  return (
    <div className="stage wide">
      <h2>Crop</h2>
      <p className="hint">
        Position the square once — it is applied identically to all four takes. Drag to move,
        drag the corner handle or scroll to resize.
      </p>
      <div className="row">
        <label className="field">
          Preview take
          <select
            value={previewVoice}
            onChange={(e) => setPreviewVoice(e.target.value as VoicePart)}
          >
            {recordedVoices.map((v) => (
              <option key={v} value={v}>
                {VOICE_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={save} disabled={busy || !displayRect}>
          Save crop
        </button>
        {saved && <span className="ok-text">✓ Saved</span>}
        {data.crop && !saved && (
          <span className="hint mono">
            saved: {data.crop.size}×{data.crop.size} at ({data.crop.x}, {data.crop.y})
          </span>
        )}
      </div>
      <div className="crop-container" style={{ width: DISPLAY_WIDTH }}>
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            width={DISPLAY_WIDTH}
            muted
            onLoadedMetadata={onMetadata}
          />
        )}
        {displayRect && videoDims && (
          <CropOverlay
            displayWidth={DISPLAY_WIDTH}
            displayHeight={displayHeight}
            value={displayRect}
            onChange={setDisplayRect}
          />
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
