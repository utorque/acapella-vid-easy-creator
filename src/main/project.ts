import { promises as fs } from 'fs'
import path from 'path'
import {
  CountInSettings,
  CropRect,
  DEFAULT_QUADRANT_MAPPING,
  ProjectData,
  TakeInfo,
  VoicePart
} from '@shared/types'
import { probeMedia, runFfmpeg } from './ffmpeg'

const PROJECT_FILE = 'project.json'

let currentDir: string | null = null
let currentData: ProjectData | null = null

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
    crop: null,
    quadrantMapping: { ...DEFAULT_QUADRANT_MAPPING }
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
  await save()
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

export async function readProjectFile(relPath: string): Promise<Buffer> {
  return fs.readFile(resolveInProject(relPath))
}
