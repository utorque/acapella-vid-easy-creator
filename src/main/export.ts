import path from 'path'
import {
  ExportProgress,
  ExportResult,
  OffsetResult,
  QUADRANTS,
  VoicePart
} from '@shared/types'
import { decodePcm, probeMedia, runFfmpegWithProgress } from './ffmpeg'
import { findOffset } from './audio-analysis'
import { getCurrent } from './project'

const ANALYSIS_RATE = 8000
const CELL_SIZE = 540

/**
 * Detect per-take guide offsets, then render the 2x2 grid with the clean
 * original track as the only audio.
 */
export async function exportVideo(onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
  const { dir, data } = getCurrent()
  if (!data.originalAudio) throw new Error('No mixed track imported')
  if (!data.pickupAudio || !data.countIn) throw new Error('Generate the count-in first')
  if (!data.crop) throw new Error('Set the crop region first')
  const voices = QUADRANTS.map((q) => data.quadrantMapping[q])
  if (new Set(voices).size !== 4) throw new Error('Each quadrant must have a distinct voice part')
  for (const v of voices) {
    if (!data.takes[v]) throw new Error(`Missing take for ${v}`)
  }

  // --- Phase 1: offset detection ---------------------------------------
  onProgress({ phase: 'analyzing', progress: 0, message: 'Decoding pickup track…' })
  const pickupPath = path.join(dir, data.pickupAudio)
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
      singingStartSec: detection.offsetSec + data.countIn.durationSec
    })
  }

  // --- Phase 2: grid render ---------------------------------------------
  onProgress({ phase: 'rendering', progress: 0, message: 'Rendering final video…' })
  const originalPath = path.join(dir, data.originalAudio)
  const originalInfo = await probeMedia(originalPath)

  const { x, y, size } = data.crop
  const args: string[] = []
  for (const off of offsets) {
    const take = data.takes[off.voice]!
    // -ss before -i: trim each take so singing starts at t=0.
    args.push('-ss', off.singingStartSec.toFixed(3), '-i', path.join(dir, take.file))
  }
  args.push('-i', originalPath)

  const cellFilters = offsets
    .map(
      (_off, i) =>
        `[${i}:v]crop=${size}:${size}:${x}:${y},scale=${CELL_SIZE}:${CELL_SIZE},setsar=1,fps=30[c${i}]`
    )
    .join(';')
  const layout = `0_0|${CELL_SIZE}_0|0_${CELL_SIZE}|${CELL_SIZE}_${CELL_SIZE}`
  const filter = `${cellFilters};[c0][c1][c2][c3]xstack=inputs=4:layout=${layout}[grid]`

  const outPath = path.join(dir, 'export', 'final.mp4')
  args.push(
    '-filter_complex', filter,
    '-map', '[grid]',
    '-map', '4:a',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-shortest',
    '-movflags', '+faststart',
    outPath
  )

  await runFfmpegWithProgress(args, originalInfo.durationSec, (fraction) =>
    onProgress({ phase: 'rendering', progress: fraction, message: 'Rendering final video…' })
  )

  onProgress({ phase: 'done', progress: 1, message: 'Export complete' })
  return { outPath, offsets }
}

export type { VoicePart }
