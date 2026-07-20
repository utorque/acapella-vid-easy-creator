import { ProjectData, QUADRANTS } from './types'

/**
 * Cheap fingerprint of everything that affects color analysis: the crop
 * region, which take file backs each voice (and when it was recorded), the
 * quadrant mapping, and the manual A/V trim. Computed identically on both
 * sides of the IPC boundary so the renderer can flag a stale correction
 * without re-running analysis.
 */
export function computeColorSourceKey(data: ProjectData): string {
  const crop = data.crop ? `${data.crop.x},${data.crop.y},${data.crop.size}` : 'none'
  const takes = QUADRANTS.map((q) => data.quadrantMapping[q])
    .map((v) => `${v}:${data.takes[v]?.file}@${data.takes[v]?.recordedAt}`)
    .join('|')
  return `${crop}::${takes}::${data.avOffsetSec ?? ''}`
}
