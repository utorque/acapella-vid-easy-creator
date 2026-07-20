import { describe, expect, it } from 'vitest'
import { GAMMA_MAX, GAMMA_MIN, colorFilterFragment, computeGamma } from '../src/main/colorFilter'
import { ColorCorrection, DEFAULT_QUADRANT_MAPPING, ProjectData } from '../src/shared/types'

function baseProject(colorCorrection: ColorCorrection | null): ProjectData {
  return {
    version: 1,
    name: 'test',
    createdAt: new Date().toISOString(),
    originalAudio: 'audio/original.wav',
    pickupAudio: 'audio/pickup.wav',
    countIn: null,
    takes: {},
    voiceAudio: {},
    crop: { x: 0, y: 0, size: 100 },
    quadrantMapping: { ...DEFAULT_QUADRANT_MAPPING },
    colorCorrection
  }
}

describe('computeGamma', () => {
  it('is ~1 when the sample already matches the target', () => {
    expect(computeGamma(128, 128)).toBeCloseTo(1, 5)
  })

  it('brightens (gamma > 1) when the sample is darker than the target', () => {
    expect(computeGamma(80, 150)).toBeGreaterThan(1)
  })

  it('darkens (gamma < 1) when the sample is brighter than the target', () => {
    expect(computeGamma(150, 80)).toBeLessThan(1)
  })

  it('clamps extreme mismatches to the plausible range', () => {
    expect(computeGamma(1, 254)).toBe(GAMMA_MAX)
    expect(computeGamma(254, 1)).toBe(GAMMA_MIN)
  })
})

describe('colorFilterFragment', () => {
  it('is empty with no stored correction', () => {
    expect(colorFilterFragment(baseProject(null), 'tenor', 0)).toBe('')
  })

  it('is empty when the correction was skipped', () => {
    const data = baseProject({ status: 'skipped', sourceKey: 'k', perVoice: {} })
    expect(colorFilterFragment(data, 'tenor', 0)).toBe('')
  })

  it('is empty for a voice with no keyframes', () => {
    const data = baseProject({ status: 'applied', sourceKey: 'k', perVoice: {} })
    expect(colorFilterFragment(data, 'tenor', 0)).toBe('')
  })

  it('builds a static expression for a single keyframe (no time dependency)', () => {
    const data = baseProject({
      status: 'applied',
      sourceKey: 'k',
      perVoice: { tenor: [{ fileTimeSec: 5, gammaR: 1.1, gammaG: 1, gammaB: 0.9 }] }
    })
    const frag = colorFilterFragment(data, 'tenor', 2.5)
    expect(frag).toContain('eq=eval=frame')
    expect(frag).not.toContain('if(')
    expect(frag).toContain('1.1000')
  })

  it('builds a piecewise expression shifted by trimSec for multiple keyframes', () => {
    const data = baseProject({
      status: 'applied',
      sourceKey: 'k',
      perVoice: {
        tenor: [
          { fileTimeSec: 2, gammaR: 1, gammaG: 1, gammaB: 1 },
          { fileTimeSec: 10, gammaR: 1.2, gammaG: 1, gammaB: 1 }
        ]
      }
    })
    const frag = colorFilterFragment(data, 'tenor', 3.25)
    expect(frag).toContain('if(lt((t+3.250)')
  })
})
