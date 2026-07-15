/**
 * End-to-end pipeline test.
 *
 * The Electron runtime cannot be downloaded in every environment, so this
 * test runs the real renderer (built UI) in Chromium with fake camera/mic
 * devices, and wires `window.api` to the real main-process modules
 * (project management, ffmpeg, offset detection, export) running in this
 * Node process. Everything except Electron's window/IPC shell is exercised:
 * count-in synthesis, synced MediaRecorder capture with the guide channel,
 * cross-correlation alignment, and the ffmpeg grid render.
 *
 * Usage: node scripts/e2e.mjs   (headless; no display needed)
 */
import { chromium } from 'playwright-core'
import { execFileSync, execSync } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ffprobePath = require('@ffprobe-installer/ffprobe').path
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TRACK_SECONDS = 6
const VOICES = ['Tenor', 'Lead', 'Baritone', 'Bass']

// --- Build the node-side lib and load it ---------------------------------
const workDir = mkdtempSync(path.join(tmpdir(), 'acapella-e2e-'))
// Emit inside the repo so the externalized node_modules imports resolve.
const libPath = path.join(repoRoot, 'out', 'e2e-lib.mjs')
execSync(
  `npx esbuild scripts/e2e-lib.ts --bundle --platform=node --format=esm ` +
    `--alias:@shared=./src/shared ` +
    `--external:@ffmpeg-installer/ffmpeg --external:@ffprobe-installer/ffprobe ` +
    `--outfile=${libPath}`,
  { cwd: repoRoot, stdio: 'pipe' }
)
const lib = await import(pathToFileURL(libPath).href)

// --- Test fixtures --------------------------------------------------------
const projectParent = path.join(workDir, 'projects')
mkdirSync(projectParent)
const trackPath = path.join(workDir, 'track.wav')
const shotsDir = process.env.E2E_SHOTS_DIR || path.join(workDir, 'shots')
mkdirSync(shotsDir, { recursive: true })

// Pink noise = broadband like real music; ideal for correlation.
execFileSync(ffmpegPath, [
  '-hide_banner', '-y',
  '-f', 'lavfi', '-i', `anoisesrc=d=${TRACK_SECONDS}:c=pink:a=0.6`,
  '-ar', '44100', '-ac', '2', trackPath
], { stdio: 'pipe' })
console.log('Generated test track:', trackPath)

// --- Serve the built renderer --------------------------------------------
const rendererDir = path.join(repoRoot, 'out', 'renderer')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const urlPath = req.url.split('?')[0]
  const filePath = path.join(rendererDir, urlPath === '/' ? 'index.html' : urlPath)
  try {
    const body = readFileSync(filePath)
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/`

// --- Launch Chromium with fake media devices ------------------------------
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'
  ]
})
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 860 } })
await context.grantPermissions(['camera', 'microphone'])
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[renderer error]', msg.text())
})

// --- window.api implementation bridging to the real node modules ----------
const b64ToBuf = (b64) => Buffer.from(b64, 'base64')
const bufToB64 = (buf) => Buffer.from(buf).toString('base64')

await page.exposeFunction('__api_createProject', async (name) => {
  return lib.createProject(projectParent, name)
})
await page.exposeFunction('__api_importAudio', async () => {
  return lib.importAudio(trackPath)
})
await page.exposeFunction('__api_readProjectFile', async (relPath) => {
  return bufToB64(await lib.readProjectFile(relPath))
})
await page.exposeFunction('__api_acceptCountIn', async (wavB64, settings) => {
  return lib.acceptCountIn(b64ToBuf(wavB64), settings)
})
await page.exposeFunction('__api_saveTake', async (voice, webmB64, offset) => {
  return lib.saveTake(voice, b64ToBuf(webmB64), offset)
})
await page.exposeFunction('__api_deleteTake', async (voice) => lib.deleteTake(voice))
await page.exposeFunction('__api_setCrop', async (crop) => lib.setCrop(crop))
await page.exposeFunction('__api_setQuadrantMapping', async (m) => lib.setQuadrantMapping(m))
await page.exposeFunction('__api_exportVideo', async () => {
  return lib.exportVideo((p) => console.log(`[export] ${p.phase} ${(p.progress * 100).toFixed(0)}% ${p.message}`))
})

await page.addInitScript(() => {
  const u8ToB64 = (u8) => {
    let s = ''
    const CHUNK = 0x8000
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
    }
    return btoa(s)
  }
  const b64ToU8 = (b64) => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
  }
  window.api = {
    createProject: (name) => window.__api_createProject(name),
    openProject: () => Promise.resolve(null),
    openProjectPath: () => Promise.reject(new Error('not used in e2e')),
    importAudio: () => window.__api_importAudio(),
    readProjectFile: async (rel) => b64ToU8(await window.__api_readProjectFile(rel)),
    acceptCountIn: (wav, settings) => window.__api_acceptCountIn(u8ToB64(wav), settings),
    saveTake: (voice, webm, offset) => window.__api_saveTake(voice, u8ToB64(webm), offset),
    deleteTake: (voice) => window.__api_deleteTake(voice),
    setCrop: (crop) => window.__api_setCrop(crop),
    setQuadrantMapping: (m) => window.__api_setQuadrantMapping(m),
    exportVideo: () => window.__api_exportVideo(),
    onExportProgress: () => () => {},
    showItemInFolder: () => Promise.resolve()
  }
})

await page.goto(baseUrl)
const shot = async (name) => {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) })
}

// --- Stage 1: project + import -----------------------------------------
await page.getByPlaceholder('e.g. sweet-adeline').fill('e2e-test')
await page.getByRole('button', { name: 'Create project…' }).click()
await page.getByText('Project folder:').waitFor()
console.log('Project created')

await page.getByRole('button', { name: 'Import track…' }).click()
await page.getByText('✓ audio/original.wav').waitFor()
await shot('1-project')
console.log('Track imported')

// --- Stage 2: count-in ---------------------------------------------------
await page.getByRole('button', { name: '2 · Count-in' }).click()
await page.getByRole('button', { name: 'Accept — generate pickup track' }).click()
await page.getByText('✓ Pickup track generated').waitFor()
await shot('2-countin')
console.log('Pickup track generated')

// --- Stage 3: capture all four voices -----------------------------------
await page.getByRole('button', { name: '3 · Capture' }).click()
for (const voice of VOICES) {
  await page.locator('.voice-item', { hasText: voice }).click()
  await page.getByRole('button', { name: `● Record ${voice}` }).click()
  await page.locator('.rec-badge').waitFor()
  if (voice === VOICES[0]) await shot('3-capture-recording')
  // Auto-stops when the guide (count-in + track) finishes.
  await page.getByRole('button', { name: '✓ Accept take' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '✓ Accept take' }).click()
  await page.locator('.voice-item', { hasText: voice }).getByText('✓ recorded').waitFor()
  console.log(`Captured ${voice}`)
}
await shot('3-capture-done')

// --- Stage 4: crop -------------------------------------------------------
await page.getByRole('button', { name: '4 · Crop' }).click()
await page.locator('.crop-box').waitFor()
await page.getByRole('button', { name: 'Save crop' }).click()
await page.getByText('✓ Saved').waitFor()
await shot('4-crop')
console.log('Crop saved')

// --- Stage 5: export -----------------------------------------------------
await page.getByRole('button', { name: '5 · Export' }).click()
await page.getByRole('button', { name: 'Export final video' }).click()
await page.getByText('✓ Exported:').waitFor({ timeout: 180000 })
await shot('5-export')

const offsetRows = await page.locator('table.offsets tbody tr').allInnerTexts()
console.log('Detected offsets (voice | guide found at | singing starts | confidence):')
for (const row of offsetRows) console.log(' ', row.replace(/\t/g, ' | '))

await browser.close()
server.close()

// --- Verify the exported file -------------------------------------------
const outPath = path.join(projectParent, 'e2e-test', 'export', 'final.mp4')
if (!existsSync(outPath)) throw new Error(`Export missing: ${outPath}`)
const probe = JSON.parse(
  execFileSync(ffprobePath, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', outPath
  ]).toString()
)
const video = probe.streams.find((s) => s.codec_type === 'video')
const audio = probe.streams.find((s) => s.codec_type === 'audio')
const duration = Number(probe.format.duration)

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log('OK:', msg)
}
assert(video && video.width === 1080 && video.height === 1080, `video is 1080x1080 (got ${video?.width}x${video?.height})`)
assert(video.codec_name === 'h264', `video codec h264 (got ${video?.codec_name})`)
assert(audio && audio.codec_name === 'aac', `audio codec aac (got ${audio?.codec_name})`)
assert(Math.abs(duration - TRACK_SECONDS) < 0.6, `duration ≈ ${TRACK_SECONDS}s (got ${duration.toFixed(2)}s)`)

const cells = offsetRows.map((r) => r.split('\t'))
const singStarts = cells.map((c) => Number(c[2].replace(' s', '')))
const confidences = cells.map((c) => Number(c[3].replace('%', '')))
assert(singStarts.every((s) => Number.isFinite(s) && s > 2 && s < 6), `singing starts in plausible range: ${singStarts.join(', ')}`)
assert(confidences.every((c) => c >= 60), `all alignment confidences >= 60%: ${confidences.join(', ')}`)

console.log('\nE2E PASSED — export at', outPath)
console.log('Screenshots in', shotsDir)
