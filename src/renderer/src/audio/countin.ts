const SAMPLE_RATE = 44100

/**
 * Synthesize the count-in click pattern: `beats` clicks at `bpm`, the first
 * beat accented (higher pitch). The buffer duration is exactly
 * beats * 60 / bpm seconds, so the track spliced right after it starts on
 * the beat following the last click.
 */
export async function renderCountIn(bpm: number, beats: number): Promise<AudioBuffer> {
  const beatSec = 60 / bpm
  const durationSec = beats * beatSec
  const ctx = new OfflineAudioContext(1, Math.round(durationSec * SAMPLE_RATE), SAMPLE_RATE)

  for (let i = 0; i < beats; i++) {
    const t = i * beatSec
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = i === 0 ? 1568 : 1047 // G6 accent, C6 clicks
    gain.gain.setValueAtTime(0.9, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.08)
  }

  return ctx.startRendering()
}

export function countInDurationSec(bpm: number, beats: number): number {
  return (beats * 60) / bpm
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const numFrames = buffer.length
  const bytesPerSample = 2
  const dataSize = numFrames * numChannels * bytesPerSample
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))
  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const clamped = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
  }
  return new Uint8Array(out)
}

export interface PreviewHandle {
  stop: () => void
}

/**
 * Preview the count-in spliced sample-accurately into the start of the track:
 * both sources are scheduled on the same AudioContext clock.
 */
export function previewCountIn(
  ctx: AudioContext,
  countIn: AudioBuffer,
  track: AudioBuffer,
  trackSeconds = 8,
  onEnded?: () => void
): PreviewHandle {
  const t0 = ctx.currentTime + 0.15
  const countInSrc = ctx.createBufferSource()
  countInSrc.buffer = countIn
  countInSrc.connect(ctx.destination)
  countInSrc.start(t0)

  const trackSrc = ctx.createBufferSource()
  trackSrc.buffer = track
  trackSrc.connect(ctx.destination)
  const trackStart = t0 + countIn.duration
  trackSrc.start(trackStart, 0, trackSeconds)
  trackSrc.onended = () => onEnded?.()

  return {
    stop: () => {
      try {
        countInSrc.stop()
        trackSrc.stop()
      } catch {
        // already stopped
      }
      onEnded?.()
    }
  }
}
