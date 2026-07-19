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

/** Default manual A/V sync trim: typical webcam capture latency. */
export const DEFAULT_AV_OFFSET_SEC = 0.07

/** Default share of the per-voice reference audible in the recording monitor. */
export const DEFAULT_VOICE_MONITOR_RATIO = 0.25

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

/** One point on a take's color-correction curve. */
export interface ColorKeyframe {
  /** Time within this take's own file, seconds (matches the ffmpeg -ss trim math). */
  fileTimeSec: number
  gammaR: number
  gammaG: number
  gammaB: number
}

export interface ColorCorrection {
  status: 'applied' | 'skipped'
  /** Hash of crop+takes+quadrantMapping+avOffset; stale once it no longer matches. */
  sourceKey: string
  perVoice: Partial<Record<VoicePart, ColorKeyframe[]>>
}

/** Mean color sampled from one take's crop region at one timeline point. */
export interface ColorSampleMean {
  r: number
  g: number
  b: number
}

/** One review point: same instant across all four takes, before and after correction. */
export interface ColorPreviewSample {
  /** Position on the shared/final timeline, seconds. */
  tSec: number
  before: Partial<Record<VoicePart, string>>
  after: Partial<Record<VoicePart, string>>
}

export interface ColorAnalysisResult {
  correction: ColorCorrection
  samples: ColorPreviewSample[]
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
  /**
   * Optional per-voice reference tracks (relative paths), same length as
   * `originalAudio`, used to show a synced waveform while recording that voice.
   */
  voiceAudio: Partial<Record<VoicePart, string>>
  crop: CropRect | null
  quadrantMapping: Record<Quadrant, VoicePart>
  /**
   * Manual A/V sync trim, seconds. Positive values shift all videos earlier
   * relative to the soundtrack (compensates webcam capture latency, which
   * delays every take's video by the same amount relative to the guide audio).
   */
  avOffsetSec?: number
  colorCorrection: ColorCorrection | null
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
  /**
   * How the soundtrack got into the file: 'copied' = the imported track's
   * bytes are muxed in untouched (no quality change possible); 'encoded' =
   * lossless source encoded once to AAC 320k.
   */
  audioAction: 'copied' | 'encoded'
  audioCodec: string
}

export interface PreviewResult {
  /** Path of the rendered preview, relative to the project folder. */
  relPath: string
  offsets: OffsetResult[]
}

/** Audio stream facts about the imported track, from ffprobe. */
export interface AudioInfo {
  codec: string
  sampleRate: number
  channels: number
  durationSec: number
  /** kbit/s, 0 if unknown (typical for lossless). */
  bitrateKbps: number
  lossless: boolean
  /** Whether the export can mux this stream into MP4 bit-exact (no re-encode). */
  willCopy: boolean
}
