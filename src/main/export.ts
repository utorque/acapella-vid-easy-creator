import path from 'path'
import {
  DEFAULT_AV_OFFSET_SEC,
  ExportProgress,
  ExportResult,
  OffsetResult,
  PreviewResult,
  QUADRANTS,
  VoicePart
} from '@shared/types'
import { canCopyToMp4, decodePcm, probeMedia, runFfmpegWithProgress } from './ffmpeg'
import { findOffset } from './audio-analysis'
import { getCurrent } from './project'
import { colorFilterFragment } from './colorFilter'

const ANALYSIS_RATE = 8000
const CELL_SIZE = 540
const PREVIEW_CELL_SIZE = 270

// Offset detection is deterministic for a given set of takes + pickup track;
// cache it so preview renders and the final export don't re-analyze.
let offsetsCache: { key: string; offsets: OffsetResult[] } | null = null

function analysisKey(dir: string): string {
  const { data } = getCurrent()
  const takes = QUADRANTS.map((q) => data.takes[data.quadrantMapping[q]])
    .map((t) => `${t?.file}@${t?.recordedAt}`)
    .join('|')
  return `${dir}::${data.pickupAudio}::${data.countIn?.durationSec}::${takes}`
}

export function requireReady(): { dir: string; voices: VoicePart[] } {
  const { dir, data } = getCurrent()
  if (!data.originalAudio) throw new Error('No mixed track imported')
  if (!data.pickupAudio || !data.countIn) throw new Error('Generate the count-in first')
  if (!data.crop) throw new Error('Set the crop region first')
  const voices = QUADRANTS.map((q) => data.quadrantMapping[q])
  if (new Set(voices).size !== 4) throw new Error('Each quadrant must have a distinct voice part')
  for (const v of voices) {
    if (!data.takes[v]) throw new Error(`Missing take for ${v}`)
  }
  return { dir, voices }
}

/**
 * Detect (and cache) per-take guide offsets. Shared by export, sync preview,
 * and color analysis so all three agree on exactly where each take's
 * "singing starts" moment is.
 */
export async function detectOffsets(
  onProgress: (p: ExportProgress) => void
): Promise<OffsetResult[]> {
  const { dir, data } = getCurrent()
  const { voices } = requireReady()
  const key = analysisKey(dir)
  if (offsetsCache?.key === key) return offsetsCache.offsets

  onProgress({ phase: 'analyzing', progress: 0, message: 'Decoding pickup track…' })
  const pickupPath = path.join(dir, data.pickupAudio!)
  const reference = await decodePcm(pickupPath, ANALYSIS_RATE, 'mix')

  const offsets: OffsetResult[] = []
  for (let i = 0; i < voices.length; i++) {
    const voice = voices[i]
    const take = data.takes[voice]!
    onProgress({
      phase: 'analyzing',
      progress: (i + 1) / (voices.length + 1),
      message: `Aligning ${voice} take…`
    })
    const guide = await decodePcm(path.join(dir, take.file), ANALYSIS_RATE, 'left')
    const est = Math.max(0, take.scheduledOffsetSec)
    const detection = findOffset(reference, guide, ANALYSIS_RATE, Math.max(0, est - 1.5), est + 1.5)
    if (detection.confidence < 0.25) {
      throw new Error(
        `Could not align the ${voice} take (confidence ${detection.confidence.toFixed(2)}). ` +
          'The guide audio was not found in the recording — try re-recording this part.'
      )
    }
    offsets.push({
      voice,
      offsetSec: detection.offsetSec,
      confidence: detection.confidence,
      singingStartSec: detection.offsetSec + data.countIn!.durationSec
    })
  }
  offsetsCache = { key, offsets }
  return offsets
}

/**
 * Shared grid assembly for export and preview. `windowStartSec` shifts every
 * video trim AND the audio start by the same amount, so a preview window is
 * aligned by exactly the same arithmetic as the full export.
 */
function buildGridArgs(opts: {
  offsets: OffsetResult[]
  originalPath: string
  outPath: string
  avOffsetSec: number
  cellSize: number
  windowStartSec: number
  durationSec: number
  preview: boolean
  audioCodecArgs: string[]
}): string[] {
  const { dir, data } = getCurrent()
  const { x, y, size } = data.crop!
  const args: string[] = []
  // -ss before -i: trim each take so singing (plus the manual A/V trim and
  // the preview window position) starts at t=0. Also the time origin the
  // color-correction curve (stored in each take's own file time) is shifted
  // against below.
  const trims = opts.offsets.map((off) =>
    Math.max(0, off.singingStartSec + opts.avOffsetSec + opts.windowStartSec)
  )
  opts.offsets.forEach((off, i) => {
    const take = data.takes[off.voice]!
    args.push('-ss', trims[i].toFixed(3), '-i', path.join(dir, take.file))
  })
  args.push('-i', opts.originalPath)

  const cell = opts.cellSize
  const cellFilters = opts.offsets
    .map((off, i) => {
      const chain = [
        `crop=${size}:${size}:${x}:${y}`,
        colorFilterFragment(data, off.voice, trims[i]),
        `scale=${cell}:${cell}`,
        'setsar=1',
        'fps=30'
      ]
        .filter(Boolean)
        .join(',')
      return `[${i}:v]${chain}[c${i}]`
    })
    .join(';')
  const layout = `0_0|${cell}_0|0_${cell}|${cell}_${cell}`
  let filter = `${cellFilters};[c0][c1][c2][c3]xstack=inputs=4:layout=${layout}[grid]`

  if (opts.preview && opts.windowStartSec > 0) {
    // Sample-accurate audio window (atrim, not packet seeking), so the
    // preview's A/V relationship matches the export exactly.
    filter += `;[4:a]atrim=start=${opts.windowStartSec.toFixed(3)},asetpts=PTS-STARTPTS[aud]`
  }

  args.push('-filter_complex', filter, '-map', '[grid]')
  args.push('-map', opts.preview && opts.windowStartSec > 0 ? '[aud]' : '4:a')
  args.push(
    '-c:v', 'libx264',
    '-preset', opts.preview ? 'ultrafast' : 'medium',
    '-crf', opts.preview ? '26' : '18',
    '-pix_fmt', 'yuv420p',
    ...opts.audioCodecArgs,
    // -shortest overshoots with filter_complex; cap the output explicitly.
    '-t', opts.durationSec.toFixed(3),
    '-shortest',
    '-movflags', '+faststart',
    opts.outPath
  )
  return args
}

/**
 * Detect per-take guide offsets, then render the 2x2 grid with the clean
 * original track as the only audio. If the imported track is already an
 * MP4-compatible codec it is stream-copied (bit-exact, never re-encoded);
 * lossless sources are encoded once to AAC 320k.
 */
export async function exportVideo(onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
  const { dir, data } = getCurrent()
  requireReady()
  const offsets = await detectOffsets(onProgress)

  onProgress({ phase: 'rendering', progress: 0, message: 'Rendering final video…' })
  const originalPath = path.join(dir, data.originalAudio!)
  const originalInfo = await probeMedia(originalPath)
  const copyAudio = canCopyToMp4(originalInfo.audioCodec)

  const outPath = path.join(dir, 'export', 'final.mp4')
  const args = buildGridArgs({
    offsets,
    originalPath,
    outPath,
    avOffsetSec: data.avOffsetSec ?? DEFAULT_AV_OFFSET_SEC,
    cellSize: CELL_SIZE,
    windowStartSec: 0,
    durationSec: originalInfo.durationSec,
    preview: false,
    audioCodecArgs: copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k']
  })

  await runFfmpegWithProgress(args, originalInfo.durationSec, (fraction) =>
    onProgress({ phase: 'rendering', progress: fraction, message: 'Rendering final video…' })
  )

  onProgress({ phase: 'done', progress: 1, message: 'Export complete' })
  return {
    outPath,
    offsets,
    audioAction: copyAudio ? 'copied' : 'encoded',
    audioCodec: originalInfo.audioCodec
  }
}

/**
 * Render a short window of the final video through the exact same pipeline
 * (same offset detection, same trim arithmetic, same ffmpeg grid assembly) at
 * reduced resolution/quality. What this preview shows is what the export
 * produces, to within one video frame.
 */
export async function renderSyncPreview(
  onProgress: (p: ExportProgress) => void,
  startSec: number,
  durationSec: number
): Promise<PreviewResult> {
  const { dir, data } = getCurrent()
  requireReady()
  const offsets = await detectOffsets(onProgress)

  onProgress({ phase: 'rendering', progress: 0, message: 'Rendering sync preview…' })
  const originalPath = path.join(dir, data.originalAudio!)
  const originalInfo = await probeMedia(originalPath)
  const start = Math.min(Math.max(0, startSec), Math.max(0, originalInfo.durationSec - 1))
  const duration = Math.min(durationSec, originalInfo.durationSec - start)

  const relPath = path.posix.join('export', 'preview.mp4')
  const args = buildGridArgs({
    offsets,
    originalPath,
    outPath: path.join(dir, relPath),
    avOffsetSec: data.avOffsetSec ?? DEFAULT_AV_OFFSET_SEC,
    cellSize: PREVIEW_CELL_SIZE,
    windowStartSec: start,
    durationSec: duration,
    preview: true,
    // The preview window is cut with a filter, which forces one AAC encode;
    // the final export still stream-copies when it can.
    audioCodecArgs: ['-c:a', 'aac', '-b:a', '192k']
  })

  await runFfmpegWithProgress(args, duration, (fraction) =>
    onProgress({ phase: 'rendering', progress: fraction, message: 'Rendering sync preview…' })
  )
  onProgress({ phase: 'done', progress: 1, message: 'Preview ready' })
  return { relPath, offsets }
}

export type { VoicePart }
