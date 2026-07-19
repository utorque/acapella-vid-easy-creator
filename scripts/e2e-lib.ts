/**
 * Node-side entry for the e2e test: re-exports the real main-process project
 * and export logic (none of which depends on Electron APIs) so the test can
 * drive it directly while the renderer runs in plain Chromium.
 */
export {
  createProject,
  openProject,
  importAudio,
  acceptCountIn,
  saveTake,
  deleteTake,
  setCrop,
  setQuadrantMapping,
  setAvOffset,
  getOriginalAudioInfo,
  readProjectFile
} from '../src/main/project'
export { exportVideo, renderSyncPreview } from '../src/main/export'
