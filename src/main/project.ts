import { promises as fs } from 'fs'
import path from 'path'
import {
  AudioInfo,
  ColorCorrection,
  CountInSettings,
  CropRect,
  DEFAULT_QUADRANT_MAPPING,
  ProjectData,
  TakeInfo,
  VoicePart
} from '@shared/types'
import { canCopyToMp4, isLosslessCodec, probeMedia, runFfmpeg } from './ffmpeg'

const PROJECT_FILE = 'project.json'

let currentDir: string | null = null
let currentData: ProjectData | null = null

const VOICE_FILENAME_PATTERNS: [VoicePart, RegExp][] = [
  ['tenor', /ten/i],
  ['lead', /lead/i],
  ['baritone', /bari/i],
  ['bass', /bass/i]
]

/** Match a dropped/selected file name to a voice part, e.g. "02-Bari.wav" -> "baritone". */
export function detectVoicePart(fileName: string): VoicePart | null {
  for (const [voice, pattern] of VOICE_FILENAME_PATTERNS) {
    if (pattern.test(fileName)) return voice
  }
  return null
}

const VOICE_DURATION_TOLERANCE_SEC = 0.35

export function getCurrent(): { dir: string; data: ProjectData } {
  if (!currentDir || !currentData) throw new Error('No project is open')
  return { dir: currentDir, data: currentData }
}

export function resolveInProject(relPath: string): string {
  const { dir } = getCurrent()
  const abs = path.resolve(dir, relPath)
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`Path escapes project folder: ${relPath}`)
  }
  return abs
}

async function save(): Promise<void> {
  const { dir, data } = getCurrent()
  await fs.writeFile(path.join(dir, PROJECT_FILE), JSON.stringify(data, null, 2), 'utf8')
}

export async function createProject(parentDir: string, name: string): Promise<{ dir: string; data: ProjectData }> {
  const safeName = name.trim().replace(/[<>:"/\\|?*]/g, '_')
  if (!safeName) throw new Error('Project name is empty')
  const dir = path.join(parentDir, safeName)
  await fs.mkdir(dir, { recursive: false }).catch((e) => {
    if (e.code === 'EEXIST') throw new Error(`Folder already exists: ${dir}`)
    throw e
  })
  await fs.mkdir(path.join(dir, 'audio'))
  await fs.mkdir(path.join(dir, 'takes'))
  await fs.mkdir(path.join(dir, 'export'))
  const data: ProjectData = {
    version: 1,
    name: safeName,
    createdAt: new Date().toISOString(),
    originalAudio: null,
    pickupAudio: null,
    countIn: null,
    takes: {},
    voiceAudio: {},
    crop: null,
    quadrantMapping: { ...DEFAULT_QUADRANT_MAPPING },
    colorCorrection: null
  }
  currentDir = dir
  currentData = data
  await save()
  return { dir, data }
}

export async function openProject(dir: string): Promise<{ dir: string; data: ProjectData }> {
  const raw = await fs.readFile(path.join(dir, PROJECT_FILE), 'utf8')
  const data = JSON.parse(raw) as ProjectData
  if (data.version !== 1) throw new Error(`Unsupported project version: ${data.version}`)
  if (!data.voiceAudio) data.voiceAudio = {}
  if (data.colorCorrection === undefined) data.colorCorrection = null
  currentDir = dir
  currentData = data
  return { dir, data }
}

export async function importAudio(sourcePath: string): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  const ext = path.extname(sourcePath).toLowerCase() || '.audio'
  const rel = path.posix.join('audio', `original${ext}`)
  // Remove any previously imported original with a different extension.
  if (data.originalAudio && data.originalAudio !== rel) {
    await fs.rm(path.join(dir, data.originalAudio), { force: true })
  }
  await fs.copyFile(sourcePath, path.join(dir, rel))
  data.originalAudio = rel
  // A new original invalidates the pickup file.
  if (data.pickupAudio) {
    await fs.rm(path.join(dir, data.pickupAudio), { force: true })
    data.pickupAudio = null
    data.countIn = null
  }
  // A new original may no longer match the length of any uploaded voice references.
  for (const rel of Object.values(data.voiceAudio)) {
    if (rel) await fs.rm(path.join(dir, rel), { force: true })
  }
  data.voiceAudio = {}
  await save()
  return data
}

/**
 * Import one or more per-voice reference tracks. Each file name must contain
 * "ten"/"lead"/"bari"/"bass" to identify its voice part, and its duration must
 * match the imported mixed track within a small tolerance. Validated
 * all-or-nothing before anything is copied.
 */
export async function importVoiceAudioFiles(paths: string[]): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  if (!data.originalAudio) {
    throw new Error('Import the mixed track before adding per-voice reference audio')
  }
  const refDuration = (await probeMedia(path.join(dir, data.originalAudio))).durationSec

  const assignments: { voice: VoicePart; sourcePath: string; ext: string }[] = []
  const seen = new Set<VoicePart>()
  for (const sourcePath of paths) {
    const base = path.basename(sourcePath)
    const voice = detectVoicePart(base)
    if (!voice) {
      throw new Error(
        `Could not tell which voice part "${base}" belongs to — name it with "ten", "lead", ` +
          '"bari" or "bass".'
      )
    }
    if (seen.has(voice)) {
      throw new Error(`Two of the selected files matched ${voice} — drop one file per voice.`)
    }
    seen.add(voice)
    const info = await probeMedia(sourcePath)
    if (Math.abs(info.durationSec - refDuration) > VOICE_DURATION_TOLERANCE_SEC) {
      throw new Error(
        `"${base}" is ${info.durationSec.toFixed(2)}s long but the mixed track is ` +
          `${refDuration.toFixed(2)}s — they must be the same length.`
      )
    }
    assignments.push({ voice, sourcePath, ext: path.extname(sourcePath).toLowerCase() || '.audio' })
  }

  for (const { voice, sourcePath, ext } of assignments) {
    const rel = path.posix.join('audio', `voice-${voice}${ext}`)
    const existing = data.voiceAudio[voice]
    if (existing && existing !== rel) {
      await fs.rm(path.join(dir, existing), { force: true })
    }
    await fs.copyFile(sourcePath, path.join(dir, rel))
    data.voiceAudio[voice] = rel
  }
  await save()
  return data
}

export async function deleteVoiceAudio(voice: VoicePart): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  const rel = data.voiceAudio[voice]
  if (rel) {
    await fs.rm(path.join(dir, rel), { force: true })
    delete data.voiceAudio[voice]
    await save()
  }
  return data
}

/**
 * Write the rendered count-in WAV and produce audio/pickup.wav =
 * count-in + original, re-encoded to a uniform PCM format.
 */
export async function acceptCountIn(wav: Uint8Array, settings: CountInSettings): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  if (!data.originalAudio) throw new Error('Import the mixed track before generating a count-in')
  const countInPath = path.join(dir, 'audio', 'countin.wav')
  await fs.writeFile(countInPath, wav)
  const originalPath = path.join(dir, data.originalAudio)
  const pickupRel = path.posix.join('audio', 'pickup.wav')
  await runFfmpeg([
    '-i', countInPath,
    '-i', originalPath,
    '-filter_complex',
    '[0:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo[a0];' +
      '[1:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo[a1];' +
      '[a0][a1]concat=n=2:v=0:a=1[out]',
    '-map', '[out]',
    path.join(dir, pickupRel)
  ])
  data.countIn = settings
  data.pickupAudio = pickupRel
  await save()
  return data
}

export async function saveTake(
  voice: VoicePart,
  webm: Uint8Array,
  scheduledOffsetSec: number
): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  const rel = path.posix.join('takes', `${voice}.webm`)
  const abs = path.join(dir, rel)
  await fs.writeFile(abs, webm)
  const info = await probeMedia(abs)
  const take: TakeInfo = {
    voice,
    file: rel,
    scheduledOffsetSec,
    recordedAt: new Date().toISOString(),
    videoWidth: info.width,
    videoHeight: info.height,
    durationSec: info.durationSec
  }
  data.takes[voice] = take
  await save()
  return data
}

export async function deleteTake(voice: VoicePart): Promise<ProjectData> {
  const { dir, data } = getCurrent()
  const take = data.takes[voice]
  if (take) {
    await fs.rm(path.join(dir, take.file), { force: true })
    delete data.takes[voice]
    await save()
  }
  return data
}

/** ffprobe facts about the imported track, for display and export decisions. */
export async function getOriginalAudioInfo(): Promise<AudioInfo | null> {
  const { dir, data } = getCurrent()
  if (!data.originalAudio) return null
  const info = await probeMedia(path.join(dir, data.originalAudio))
  return {
    codec: info.audioCodec,
    sampleRate: info.audioSampleRate,
    channels: info.audioChannels,
    durationSec: info.durationSec,
    bitrateKbps: info.audioBitrateKbps,
    lossless: isLosslessCodec(info.audioCodec),
    willCopy: canCopyToMp4(info.audioCodec)
  }
}

export async function setAvOffset(avOffsetSec: number): Promise<ProjectData> {
  const { data } = getCurrent()
  data.avOffsetSec = avOffsetSec
  await save()
  return data
}

export async function setCrop(crop: CropRect): Promise<ProjectData> {
  const { data } = getCurrent()
  data.crop = crop
  await save()
  return data
}

export async function setQuadrantMapping(mapping: ProjectData['quadrantMapping']): Promise<ProjectData> {
  const { data } = getCurrent()
  data.quadrantMapping = mapping
  await save()
  return data
}

export async function setColorCorrection(correction: ColorCorrection | null): Promise<ProjectData> {
  const { data } = getCurrent()
  data.colorCorrection = correction
  await save()
  return data
}

export async function readProjectFile(relPath: string): Promise<Buffer> {
  return fs.readFile(resolveInProject(relPath))
}
