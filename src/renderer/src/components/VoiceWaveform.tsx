import { useEffect, useRef } from 'react'

interface Props {
  buffer: AudioBuffer
  /** 0..1 fraction of the buffer played so far, or null to hide the playhead. */
  progress: number | null
}

const BUCKETS = 500

function computePeaks(buffer: AudioBuffer): Float32Array {
  const data = buffer.getChannelData(0)
  const peaks = new Float32Array(BUCKETS)
  const step = Math.max(1, Math.floor(data.length / BUCKETS))
  for (let i = 0; i < BUCKETS; i++) {
    let max = 0
    const start = i * step
    const end = Math.min(data.length, start + step)
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j])
      if (v > max) max = v
    }
    peaks[i] = max
  }
  return peaks
}

/** Static peak waveform of a voice reference track, with a playhead synced to recording. */
export default function VoiceWaveform({ buffer, progress }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const peaksRef = useRef<Float32Array | null>(null)
  const progressRef = useRef(progress)
  progressRef.current = progress

  const draw = (): void => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const peaks = peaksRef.current
    if (!canvas || !container || !peaks) return
    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const mid = height / 2
    const barWidth = width / peaks.length
    ctx.fillStyle = '#5b8cff'
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * height * 0.9)
      ctx.fillRect(i * barWidth, mid - h / 2, Math.max(1, barWidth - 0.5), h)
    }
    const p = progressRef.current
    if (p !== null) {
      const x = Math.min(width - 2, Math.max(0, p * width))
      ctx.fillStyle = '#e5533d'
      ctx.fillRect(x, 0, 2, height)
    }
  }

  useEffect(() => {
    peaksRef.current = computePeaks(buffer)
    draw()
  }, [buffer])

  useEffect(() => {
    draw()
  }, [progress])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(draw)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="voice-waveform">
      <canvas ref={canvasRef} />
    </div>
  )
}
