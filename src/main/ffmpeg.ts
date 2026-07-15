import { execFile, spawn } from 'child_process'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'

// electron-builder unpacks these from the asar; fix up the path at runtime.
const fixAsarPath = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

export const ffmpegPath = fixAsarPath(ffmpegInstaller.path)
export const ffprobePath = fixAsarPath(ffprobeInstaller.path)

export function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr.slice(-2000)}`))
      else resolve(stderr)
    })
  })
}

/**
 * Run ffmpeg reporting progress as a fraction of `totalDurationSec`,
 * parsed from `-progress` key=value output on stdout.
 */
export function runFfmpegWithProgress(
  args: string[],
  totalDurationSec: number,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-y', '-progress', 'pipe:1', ...args])
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-10000)
    })
    proc.stdout.on('data', (d: Buffer) => {
      const m = /out_time_ms=(\d+)/g
      let match: RegExpExecArray | null
      let lastUs = -1
      const text = d.toString()
      while ((match = m.exec(text)) !== null) lastUs = Number(match[1])
      if (lastUs >= 0 && totalDurationSec > 0) {
        onProgress(Math.min(1, lastUs / 1e6 / totalDurationSec))
      }
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

/** Decode an input's audio to mono float32 PCM at the given rate. `pan` may select a channel first. */
export function decodePcm(
  inputPath: string,
  sampleRate: number,
  channel: 'left' | 'mix'
): Promise<Float32Array> {
  const panFilter = channel === 'left' ? 'pan=mono|c0=c0,' : ''
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-i', inputPath,
      '-vn',
      '-af', `${panFilter}aresample=${sampleRate}`,
      '-ac', '1',
      '-f', 'f32le',
      '-'
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-10000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg pcm decode failed (${code}): ${stderr.slice(-2000)}`))
        return
      }
      const buf = Buffer.concat(chunks)
      // Copy into an aligned buffer: Buffer.concat offsets are 0 but be safe.
      const out = new Float32Array(buf.length / 4)
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
      resolve(out)
    })
  })
}

export interface MediaInfo {
  durationSec: number
  width: number
  height: number
}

export function probeMedia(inputPath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', inputPath],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`ffprobe failed: ${err.message}`))
          return
        }
        try {
          const info = JSON.parse(stdout)
          const video = (info.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video')
          let durationSec = Number(info.format?.duration ?? 0)
          if (!durationSec || Number.isNaN(durationSec)) {
            const streamDur = (info.streams ?? [])
              .map((s: { duration?: string }) => Number(s.duration ?? 0))
              .filter((d: number) => d > 0)
            durationSec = streamDur.length ? Math.max(...streamDur) : 0
          }
          resolve({
            durationSec,
            width: video ? Number(video.width) : 0,
            height: video ? Number(video.height) : 0
          })
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}
