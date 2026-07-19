import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import {
  ColorAnalysisResult,
  ColorCorrection,
  ColorKeyframe,
  ColorPreviewSample,
  ColorSampleMean,
  CropRect,
  DEFAULT_AV_OFFSET_SEC,
  ExportProgress,
  ProjectData,
  VoicePart
} from '@shared/types'
import { computeColorSourceKey } from '@shared/colorKey'
import { ffmpegPath, probeMedia } from './ffmpeg'
import { computeGamma, staticGammaFilter } from './colorFilter'
import { getCurrent, setColorCorrection } from './project'
import { detectOffsets, requireReady } from './export'

/** Also the number of slider positions in the review UI — one sampling pass serves both. */
const SAMPLE_COUNT = 10
const STAT_SIZE = 24
const THUMB_SIZE = 160
const PREVIEW_DIR = path.posix.join('color', 'preview')

/** Grab one frame, cropped and scaled to `size`x`size`, as raw RGB24 bytes. */
function captureRawRgb(file: string, crop: CropRect, tSec: number, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-ss', Math.max(0, tSec).toFixed(3),
      '-i', file,
      '-frames:v', '1',
      '-vf', `crop=${crop.size}:${crop.size}:${crop.x}:${crop.y},scale=${size}:${size}`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1'
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-4000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      if (code !== 0 || buf.length === 0) {
        reject(new Error(`ffmpeg frame capture failed (${code}): ${stderr.slice(-500)}`))
        return
      }
      resolve(buf)
    })
  })
}

function meanRgb(buf: Buffer): ColorSampleMean {
  let r = 0
  let g = 0
  let b = 0
  const n = buf.length / 3
  for (let i = 0; i < buf.length; i += 3) {
    r += buf[i]
    g += buf[i + 1]
    b += buf[i + 2]
  }
  return { r: r / n, g: g / n, b: b / n }
}

/** Render one cropped [+ color-corrected] frame to a small PNG thumbnail. */
function captureThumbnail(
  file: string,
  crop: CropRect,
  tSec: number,
  outPath: string,
  extraFilter?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const filters = [
      `crop=${crop.size}:${crop.size}:${crop.x}:${crop.y}`,
      extraFilter,
      `scale=${THUMB_SIZE}:${THUMB_SIZE}`
    ]
      .filter(Boolean)
      .join(',')
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-y',
      '-ss', Math.max(0, tSec).toFixed(3),
      '-i', file,
      '-frames:v', '1',
      '-vf', filters,
      outPath
    ])
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-4000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg thumbnail render failed (${code}): ${stderr.slice(-500)}`))
    })
  })
}

/**
 * Sample all four takes' crop regions at SAMPLE_COUNT evenly-spaced points on
 * the shared/final timeline (same alignment export.ts uses), compute a
 * per-channel correction gamma pulling every take toward the grand mean, and
 * render before/after review thumbnails for those same points. Nothing is
 * persisted — the caller applies or discards the result.
 */
export async function analyzeColor(onProgress: (p: ExportProgress) => void): Promise<ColorAnalysisResult> {
  const { dir, data } = getCurrent()
  const { voices } = requireReady()
  const crop = data.crop!
  if (!data.originalAudio) throw new Error('No mixed track imported')

  onProgress({ phase: 'analyzing', progress: 0, message: 'Aligning takes…' })
  const offsets = await detectOffsets(onProgress)
  const originalInfo = await probeMedia(path.join(dir, data.originalAudio))
  const durationSec = originalInfo.durationSec
  if (durationSec <= 0) throw new Error('Could not determine the mixed track duration')

  const avOffsetSec = data.avOffsetSec ?? DEFAULT_AV_OFFSET_SEC
  const trimByVoice = new Map(
    offsets.map((o) => [o.voice, Math.max(0, o.singingStartSec + avOffsetSec)])
  )

  const previewDirAbs = path.join(dir, PREVIEW_DIR)
  await fs.rm(previewDirAbs, { recursive: true, force: true })
  await fs.mkdir(previewDirAbs, { recursive: true })

  // Evenly spaced, inset from the very edges so the first/last sample isn't a fade-in/out frame.
  const tSecs = Array.from(
    { length: SAMPLE_COUNT },
    (_, i) => ((i + 0.5) / SAMPLE_COUNT) * durationSec
  )

  // 1) Mean RGB per (voice, sample), in each take's own file time.
  type Sample = ColorSampleMean & { fileTimeSec: number }
  let measured = 0
  const totalMeasurements = voices.length * SAMPLE_COUNT
  const perVoiceSamples = new Map<VoicePart, Sample[]>(
    await Promise.all(
      voices.map(async (voice): Promise<[VoicePart, Sample[]]> => {
        const take = data.takes[voice]!
        const src = path.join(dir, take.file)
        const trim = trimByVoice.get(voice) ?? 0
        const maxFileTime = Math.max(0, take.durationSec - 0.05)
        const samples: Sample[] = []
        for (const tSec of tSecs) {
          const fileTimeSec = Math.min(trim + tSec, maxFileTime)
          const mean = meanRgb(await captureRawRgb(src, crop, fileTimeSec, STAT_SIZE))
          samples.push({ ...mean, fileTimeSec })
          measured++
          onProgress({
            phase: 'analyzing',
            progress: measured / totalMeasurements,
            message: `Measuring ${voice}…`
          })
        }
        return [voice, samples]
      })
    )
  )

  // 2) Grand target: the mean of every sample from every voice.
  const all = voices.flatMap((v) => perVoiceSamples.get(v)!)
  const target: ColorSampleMean = {
    r: all.reduce((s, x) => s + x.r, 0) / all.length,
    g: all.reduce((s, x) => s + x.g, 0) / all.length,
    b: all.reduce((s, x) => s + x.b, 0) / all.length
  }

  // 3) Per-voice, per-sample gamma keyframes pulling that take toward the target.
  const perVoice: Partial<Record<VoicePart, ColorKeyframe[]>> = {}
  for (const voice of voices) {
    perVoice[voice] = perVoiceSamples.get(voice)!.map((s) => ({
      fileTimeSec: s.fileTimeSec,
      gammaR: computeGamma(s.r, target.r),
      gammaG: computeGamma(s.g, target.g),
      gammaB: computeGamma(s.b, target.b)
    }))
  }

  const correction: ColorCorrection = {
    status: 'applied',
    sourceKey: computeColorSourceKey(data),
    perVoice
  }

  // 4) Before/after review thumbnails, reusing the same sample points/keyframes.
  const samples: ColorPreviewSample[] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const before: Partial<Record<VoicePart, string>> = {}
    const after: Partial<Record<VoicePart, string>> = {}
    await Promise.all(
      voices.map(async (voice) => {
        const take = data.takes[voice]!
        const src = path.join(dir, take.file)
        const kf = perVoice[voice]![i]
        const beforeRel = path.posix.join(PREVIEW_DIR, `${i}-${voice}-before.png`)
        const afterRel = path.posix.join(PREVIEW_DIR, `${i}-${voice}-after.png`)
        await captureThumbnail(src, crop, kf.fileTimeSec, path.join(dir, beforeRel))
        await captureThumbnail(
          src,
          crop,
          kf.fileTimeSec,
          path.join(dir, afterRel),
          staticGammaFilter(kf.gammaR, kf.gammaG, kf.gammaB)
        )
        before[voice] = beforeRel
        after[voice] = afterRel
      })
    )
    samples.push({ tSec: tSecs[i], before, after })
    onProgress({
      phase: 'rendering',
      progress: (i + 1) / SAMPLE_COUNT,
      message: 'Rendering preview thumbnails…'
    })
  }

  onProgress({ phase: 'done', progress: 1, message: 'Analysis complete' })
  return { correction, samples }
}

export async function applyColorCorrection(correction: ColorCorrection): Promise<ProjectData> {
  return setColorCorrection(correction)
}

export async function skipColorCorrection(): Promise<ProjectData> {
  const { data } = getCurrent()
  return setColorCorrection({
    status: 'skipped',
    sourceKey: computeColorSourceKey(data),
    perVoice: {}
  })
}
