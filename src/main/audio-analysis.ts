/**
 * Offset detection between a reference audio signal (the pickup track the
 * singer heard) and the guide channel recorded into a take.
 *
 * The recorded guide channel is silence until playback started, then an exact
 * copy of the reference (same digital signal routed through Web Audio), so a
 * normalized cross-correlation peak is sharp and reliable.
 */

export interface OffsetDetection {
  /** Offset of the reference within the signal, in seconds. */
  offsetSec: number
  /** Normalized correlation peak in [0, 1]. */
  confidence: number
}

/**
 * Find where `reference` starts inside `signal`.
 *
 * @param reference mono PCM of the pickup track (what was played)
 * @param signal    mono PCM of the take's guide channel (what was recorded)
 * @param sampleRate sample rate of both signals
 * @param searchStartSec lower bound of the search window (offset of reference within signal)
 * @param searchEndSec upper bound of the search window
 * @param windowSec how many seconds of the reference to correlate (default 8)
 */
export function findOffset(
  reference: Float32Array,
  signal: Float32Array,
  sampleRate: number,
  searchStartSec: number,
  searchEndSec: number,
  windowSec = 8
): OffsetDetection {
  const window = Math.min(Math.floor(windowSec * sampleRate), reference.length)
  if (window < sampleRate * 0.5) {
    throw new Error('Reference audio too short for offset detection')
  }
  const lagStart = Math.max(0, Math.floor(searchStartSec * sampleRate))
  const lagEnd = Math.min(
    Math.max(lagStart, Math.floor(searchEndSec * sampleRate)),
    Math.max(0, signal.length - window)
  )
  if (lagEnd < lagStart) {
    throw new Error('Recording is too short to contain the search window')
  }

  const ref = reference.subarray(0, window)
  let refEnergy = 0
  for (let i = 0; i < window; i++) refEnergy += ref[i] * ref[i]
  if (refEnergy === 0) throw new Error('Reference audio is silent')

  // Rolling signal energy over [lag, lag + window) for normalization.
  let sigEnergy = 0
  for (let i = lagStart; i < lagStart + window && i < signal.length; i++) {
    sigEnergy += signal[i] * signal[i]
  }

  let bestLag = lagStart
  let bestScore = -Infinity
  for (let lag = lagStart; lag <= lagEnd; lag++) {
    let dot = 0
    for (let i = 0; i < window; i++) dot += ref[i] * signal[lag + i]
    const denom = Math.sqrt(refEnergy * sigEnergy)
    const score = denom > 1e-12 ? dot / denom : 0
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
    // Slide the energy window by one sample.
    const outgoing = signal[lag]
    const incomingIdx = lag + window
    sigEnergy -= outgoing * outgoing
    if (incomingIdx < signal.length) sigEnergy += signal[incomingIdx] * signal[incomingIdx]
    if (sigEnergy < 0) sigEnergy = 0
  }

  return {
    offsetSec: bestLag / sampleRate,
    confidence: Math.max(0, Math.min(1, bestScore))
  }
}
