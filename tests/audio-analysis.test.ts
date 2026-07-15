import { describe, expect, it } from 'vitest'
import { findOffset } from '../src/main/audio-analysis'

const RATE = 8000

/**
 * Deterministic pseudo-random noise, roughly broadband like music. Hash-based
 * per index so different seeds give genuinely independent streams (an LCG's
 * streams are time-shifted copies of one orbit and would correlate).
 */
function makeNoise(seconds: number, seed = 1234): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE))
  for (let i = 0; i < out.length; i++) {
    let h = (Math.imul(i, 2654435761) + Math.imul(seed, 40503)) >>> 0
    h ^= h >>> 16
    h = Math.imul(h, 2246822507) >>> 0
    h ^= h >>> 13
    h = Math.imul(h, 3266489909) >>> 0
    h = (h ^ (h >>> 16)) >>> 0
    out[i] = (h / 0xffffffff) * 2 - 1
  }
  return out
}

/** Build a "recording": silence, then the reference at `offsetSec`, scaled + noisy. */
function makeRecording(
  reference: Float32Array,
  offsetSec: number,
  totalSec: number,
  gain = 0.7,
  noiseAmp = 0.05
): Float32Array {
  const background = makeNoise(totalSec, 424242)
  const out = new Float32Array(Math.floor(totalSec * RATE))
  const start = Math.round(offsetSec * RATE)
  for (let i = 0; i < out.length; i++) out[i] = background[i] * noiseAmp
  for (let i = 0; i < reference.length && start + i < out.length; i++) {
    out[start + i] += reference[i] * gain
  }
  return out
}

describe('findOffset', () => {
  it('recovers a known offset within one sample', () => {
    const reference = makeNoise(10)
    const trueOffset = 0.437
    const signal = makeRecording(reference, trueOffset, 12)
    const result = findOffset(reference, signal, RATE, 0, 2)
    expect(Math.abs(result.offsetSec - trueOffset)).toBeLessThanOrEqual(1 / RATE)
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('recovers offsets near the search-window estimate', () => {
    const reference = makeNoise(10, 99)
    for (const trueOffset of [0.05, 0.35, 1.2]) {
      const signal = makeRecording(reference, trueOffset, 13)
      const est = trueOffset + 0.08 // deliberately imperfect estimate
      const result = findOffset(reference, signal, RATE, Math.max(0, est - 1.5), est + 1.5)
      expect(Math.abs(result.offsetSec - trueOffset)).toBeLessThanOrEqual(1 / RATE)
    }
  })

  it('is immune to DC bias in the recording', () => {
    const reference = makeNoise(10, 55)
    const trueOffset = 0.62
    const signal = makeRecording(reference, trueOffset, 12)
    for (let i = 0; i < signal.length; i++) signal[i] += 0.3
    const result = findOffset(reference, signal, RATE, 0, 2)
    expect(Math.abs(result.offsetSec - trueOffset)).toBeLessThanOrEqual(1 / RATE)
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('reports low confidence when the guide is absent', () => {
    const reference = makeNoise(10, 7)
    const unrelated = makeNoise(12, 900001)
    const result = findOffset(reference, unrelated, RATE, 0, 2)
    expect(result.confidence).toBeLessThan(0.25)
  })

  it('rejects a reference that is too short', () => {
    expect(() => findOffset(new Float32Array(100), makeNoise(5), RATE, 0, 1)).toThrow()
  })

  it('rejects a silent reference', () => {
    const silent = new Float32Array(RATE * 9)
    expect(() => findOffset(silent, makeNoise(10), RATE, 0, 1)).toThrow()
  })
})
