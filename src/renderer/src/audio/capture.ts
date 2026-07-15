/**
 * Synced take recording.
 *
 * The MediaRecorder stream is composed of the webcam video track plus a
 * synthetic stereo audio track built with Web Audio:
 *   left channel  = the guide playback (count-in + track) — the exact signal
 *                   the singer hears
 *   right channel = the microphone
 *
 * Because the recorder muxes this audio against the video frames itself, the
 * guide audio inside the file is locked to the video by construction. At
 * export time the main process finds the guide's exact position in the
 * recording by cross-correlation, so recorder start latency does not matter.
 * `scheduledOffsetSec` (guide start relative to recorder start, measured on
 * the AudioContext clock) is only the initial estimate for that search.
 */

export interface RecordingHandle {
  stop: () => Promise<TakeRecording>
  /** Stop everything without producing a take (user cancelled). */
  cancel: () => void
  readonly guideDurationSec: number
}

export interface TakeRecording {
  blob: Blob
  mimeType: string
  scheduledOffsetSec: number
}

const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

export function pickRecorderMime(): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  throw new Error('MediaRecorder does not support WebM recording')
}

export async function startTakeRecording(opts: {
  ctx: AudioContext
  videoTrack: MediaStreamTrack
  micStream: MediaStream
  guideBuffer: AudioBuffer
  onGuideEnded?: () => void
}): Promise<RecordingHandle> {
  const { ctx, videoTrack, micStream, guideBuffer, onGuideEnded } = opts
  if (ctx.state !== 'running') await ctx.resume()

  // Audio graph: guide -> left, mic -> right, merged into the recorded track.
  const merger = ctx.createChannelMerger(2)
  const dest = ctx.createMediaStreamDestination()
  dest.channelCount = 2
  merger.connect(dest)

  const guideSrc = ctx.createBufferSource()
  guideSrc.buffer = guideBuffer
  const guideMono = ctx.createGain()
  guideMono.channelCount = 1
  guideMono.channelCountMode = 'explicit'
  guideMono.channelInterpretation = 'speakers'
  guideSrc.connect(guideMono)
  guideMono.connect(merger, 0, 0)
  // The singer hears the guide on speakers/headphones.
  guideSrc.connect(ctx.destination)

  const micSrc = ctx.createMediaStreamSource(micStream)
  const micMono = ctx.createGain()
  micMono.channelCount = 1
  micMono.channelCountMode = 'explicit'
  micMono.channelInterpretation = 'speakers'
  micSrc.connect(micMono)
  micMono.connect(merger, 0, 1)

  const recStream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()])
  const mimeType = pickRecorderMime()
  const recorder = new MediaRecorder(recStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 192_000
  })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // Start the recorder, then schedule the guide slightly in the future on the
  // AudioContext clock so playback begins at a known time.
  const recorderStartCtxTime = await new Promise<number>((resolve, reject) => {
    recorder.onstart = () => resolve(ctx.currentTime)
    recorder.onerror = () => reject(new Error('MediaRecorder failed to start'))
    recorder.start(250)
  })
  const guideStartCtxTime = ctx.currentTime + 0.35
  guideSrc.start(guideStartCtxTime)
  guideSrc.onended = () => onGuideEnded?.()
  const scheduledOffsetSec = guideStartCtxTime - recorderStartCtxTime

  const teardown = (): void => {
    try {
      guideSrc.onended = null
      guideSrc.stop()
    } catch {
      // already stopped
    }
    guideSrc.disconnect()
    micSrc.disconnect()
    merger.disconnect()
  }

  return {
    guideDurationSec: guideBuffer.duration,
    stop: () =>
      new Promise<TakeRecording>((resolve, reject) => {
        recorder.onstop = () => {
          teardown()
          resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType, scheduledOffsetSec })
        }
        recorder.onerror = () => {
          teardown()
          reject(new Error('MediaRecorder failed'))
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.ondataavailable = null
      try {
        recorder.stop()
      } catch {
        // not running
      }
      teardown()
    }
  }
}
