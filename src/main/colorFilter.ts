import { ColorKeyframe, ProjectData, VoicePart } from '@shared/types'

export const GAMMA_MIN = 0.5
export const GAMMA_MAX = 2.0

/**
 * Solve the `eq` filter's gamma that maps a sampled mean channel value
 * (0-255) toward the target mean (0-255): eq applies roughly
 * `out = (in/255)^(1/gamma) * 255`, so `gamma = ln(in) / ln(target)` in
 * normalized [0,1] space. Clamped to keep corrections plausible.
 */
export function computeGamma(sampleMean: number, targetMean: number): number {
  const clamp01 = (v: number): number => Math.min(0.98, Math.max(0.02, v))
  const m = clamp01(sampleMean / 255)
  const t = clamp01(targetMean / 255)
  const gamma = Math.log(m) / Math.log(t)
  return Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, gamma))
}

/**
 * Build one channel's ffmpeg `eq`-filter expression: piecewise-linear
 * through `keyframes` (held constant before the first / after the last).
 * `t` in the returned expression is ffmpeg's frame time *after* the export's
 * `-ss` trim; `trimSec` shifts it back to the keyframes' own file-time axis
 * (the same `trim` value export.ts already computes per take).
 */
function channelExpr(
  keyframes: ColorKeyframe[],
  trimSec: number,
  pick: (k: ColorKeyframe) => number
): string {
  if (keyframes.length === 1) return pick(keyframes[0]).toFixed(4)
  const T = `(t+${trimSec.toFixed(3)})`
  let expr = pick(keyframes[keyframes.length - 1]).toFixed(4)
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    const va = pick(a)
    const vb = pick(b)
    const span = (b.fileTimeSec - a.fileTimeSec).toFixed(3)
    const seg = `(${va.toFixed(4)}+(${(vb - va).toFixed(4)})*(${T}-${a.fileTimeSec.toFixed(3)})/${span})`
    expr = `if(lt(${T},${b.fileTimeSec.toFixed(3)}),${seg},${expr})`
  }
  expr = `if(lt(${T},${keyframes[0].fileTimeSec.toFixed(3)}),${pick(keyframes[0]).toFixed(4)},${expr})`
  return expr
}

/** Static (non time-varying) gamma filter — for single-frame renders. */
export function staticGammaFilter(gammaR: number, gammaG: number, gammaB: number): string {
  return `eq=gamma_r=${gammaR.toFixed(4)}:gamma_g=${gammaG.toFixed(4)}:gamma_b=${gammaB.toFixed(4)}`
}

/**
 * ffmpeg filter-graph fragment (no leading/trailing comma) applying a take's
 * stored color-correction curve at render time, or `''` if there is none /
 * it was skipped. This is the seam export.ts splices into its per-take
 * filter chain, and where future manual grading would append more fragments.
 */
export function colorFilterFragment(data: ProjectData, voice: VoicePart, trimSec: number): string {
  const correction = data.colorCorrection
  if (!correction || correction.status !== 'applied') return ''
  const keyframes = correction.perVoice[voice]
  if (!keyframes || keyframes.length === 0) return ''
  const r = channelExpr(keyframes, trimSec, (k) => k.gammaR)
  const g = channelExpr(keyframes, trimSec, (k) => k.gammaG)
  const b = channelExpr(keyframes, trimSec, (k) => k.gammaB)
  return `eq=eval=frame:gamma_r='${r}':gamma_g='${g}':gamma_b='${b}'`
}
