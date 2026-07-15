/**
 * Offset detection between a reference audio signal (the pickup track the
 * singer heard) and the guide channel recorded into a take.
 *
 * The recorded guide channel is silence until playback started, then an exact
 * copy of the reference (same digital signal routed through Web Audio), so a
 * normalized cross-correlation peak is sharp and reliable. The correlation is
 * computed with an FFT so the full window/search range stays cheap.
 */

export interface OffsetDetection {
  /** Offset of the reference within the signal, in seconds. */
  offsetSec: number
  /** Normalized correlation peak in [0, 1]. */
  confidence: number
}

/** In-place iterative radix-2 complex FFT (inverse when `invert`). */
function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1)
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

/**
 * Cross-correlation dots[k] = sum_i ref[i] * seg[k + i] for k in
 * [0, numLags), computed via FFT.
 */
function correlate(ref: Float32Array, seg: Float32Array, numLags: number): Float64Array {
  let n = 1
  while (n < seg.length + ref.length) n <<= 1
  const aRe = new Float64Array(n)
  const aIm = new Float64Array(n)
  const bRe = new Float64Array(n)
  const bIm = new Float64Array(n)
  for (let i = 0; i < ref.length; i++) aRe[i] = ref[i]
  for (let i = 0; i < seg.length; i++) bRe[i] = seg[i]
  fft(aRe, aIm, false)
  fft(bRe, bIm, false)
  // conj(A) * B — the IFFT's first numLags bins are the correlation lags.
  for (let i = 0; i < n; i++) {
    const re = aRe[i] * bRe[i] + aIm[i] * bIm[i]
    const im = aRe[i] * bIm[i] - aIm[i] * bRe[i]
    aRe[i] = re
    aIm[i] = im
  }
  fft(aRe, aIm, true)
  return aRe.subarray(0, numLags) as Float64Array
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
  const numLags = lagEnd - lagStart + 1

  // Zero-mean normalized cross-correlation so DC bias (e.g. from a cheap
  // capture chain) cannot inflate the score.
  const ref = reference.subarray(0, window)
  let refSum = 0
  for (let i = 0; i < window; i++) refSum += ref[i]
  const refMean = refSum / window
  let refVar = 0
  for (let i = 0; i < window; i++) {
    const d = ref[i] - refMean
    refVar += d * d
  }
  if (refVar <= 1e-12) throw new Error('Reference audio is silent')

  const seg = signal.subarray(lagStart, lagEnd + window)
  const dots = correlate(ref, seg, numLags)

  // Rolling sum and energy of seg over [k, k + window) for normalization.
  let sigSum = 0
  let sigEnergy = 0
  for (let i = 0; i < window; i++) {
    sigSum += seg[i]
    sigEnergy += seg[i] * seg[i]
  }

  let bestLag = 0
  let bestScore = -Infinity
  for (let k = 0; k < numLags; k++) {
    const sigMean = sigSum / window
    // Centered dot product: sum (ref - mr)(seg - ms) = dot - mr*sigSum - ms*refSum + n*mr*ms
    const centeredDot = dots[k] - refMean * sigSum - sigMean * refSum + window * refMean * sigMean
    const sigVar = Math.max(0, sigEnergy - window * sigMean * sigMean)
    const denom = Math.sqrt(refVar * sigVar)
    const score = denom > 1e-9 ? centeredDot / denom : 0
    if (score > bestScore) {
      bestScore = score
      bestLag = k
    }
    const outgoing = seg[k]
    const incomingIdx = k + window
    sigSum -= outgoing
    sigEnergy -= outgoing * outgoing
    if (incomingIdx < seg.length) {
      sigSum += seg[incomingIdx]
      sigEnergy += seg[incomingIdx] * seg[incomingIdx]
    }
  }

  return {
    offsetSec: (lagStart + bestLag) / sampleRate,
    confidence: Math.max(0, Math.min(1, bestScore))
  }
}
