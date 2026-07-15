export type VoicePart = 'tenor' | 'lead' | 'baritone' | 'bass'

export const VOICE_PARTS: VoicePart[] = ['tenor', 'lead', 'baritone', 'bass']

export const VOICE_LABELS: Record<VoicePart, string> = {
  tenor: 'Tenor',
  lead: 'Lead',
  baritone: 'Baritone',
  bass: 'Bass'
}

export type Quadrant = 'tl' | 'tr' | 'bl' | 'br'

export const QUADRANTS: Quadrant[] = ['tl', 'tr', 'bl', 'br']

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  tl: 'Top left',
  tr: 'Top right',
  bl: 'Bottom left',
  br: 'Bottom right'
}

export const DEFAULT_QUADRANT_MAPPING: Record<Quadrant, VoicePart> = {
  tl: 'tenor',
  tr: 'lead',
  bl: 'baritone',
  br: 'bass'
}

export interface CountInSettings {
  bpm: number
  beats: number
  /** Exact duration of the rendered count-in in seconds (beats * 60 / bpm). */
  durationSec: number
}

export interface TakeInfo {
  voice: VoicePart
  /** Path relative to the project folder, e.g. "takes/tenor.webm". */
  file: string
  /**
   * Estimated start of guide playback relative to the start of the recording,
   * in seconds (scheduled AudioContext time minus MediaRecorder start time).
   * Refined by cross-correlation at export time.
   */
  scheduledOffsetSec: number
  recordedAt: string
  videoWidth: number
  videoHeight: number
  durationSec: number
}

/** Square crop region in source-video pixel coordinates. */
export interface CropRect {
  x: number
  y: number
  size: number
}

export interface ProjectData {
  version: 1
  name: string
  createdAt: string
  /** Relative path of the imported mixed track, e.g. "audio/original.mp3". */
  originalAudio: string | null
  /** Relative path of the count-in + track file used during capture. */
  pickupAudio: string | null
  countIn: CountInSettings | null
  takes: Partial<Record<VoicePart, TakeInfo>>
  crop: CropRect | null
  quadrantMapping: Record<Quadrant, VoicePart>
}

export interface ProjectHandle {
  dir: string
  data: ProjectData
}

export interface ExportProgress {
  phase: 'analyzing' | 'rendering' | 'done' | 'error'
  /** 0..1 within the current phase. */
  progress: number
  message: string
}

export interface OffsetResult {
  voice: VoicePart
  /** Detected guide-playback start within the recording, seconds. */
  offsetSec: number
  /** Correlation peak, 0..1 — how confident the alignment is. */
  confidence: number
  /** offsetSec + count-in duration: where singing starts in the take. */
  singingStartSec: number
}

export interface ExportResult {
  outPath: string
  offsets: OffsetResult[]
}
