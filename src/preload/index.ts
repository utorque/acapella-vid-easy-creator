import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AudioInfo,
  CountInSettings,
  CropRect,
  ExportProgress,
  ExportResult,
  PreviewResult,
  ProjectData,
  ProjectHandle,
  VoicePart
} from '../shared/types'

const api = {
  createProject: (name: string): Promise<ProjectHandle | null> =>
    ipcRenderer.invoke('project:create', name),
  openProject: (): Promise<ProjectHandle | null> => ipcRenderer.invoke('project:open'),
  openProjectPath: (dir: string): Promise<ProjectHandle> =>
    ipcRenderer.invoke('project:openPath', dir),
  importAudio: (): Promise<ProjectData | null> => ipcRenderer.invoke('project:importAudio'),
  importVoiceAudioDialog: (): Promise<ProjectData | null> =>
    ipcRenderer.invoke('project:importVoiceAudioDialog'),
  importVoiceAudioPaths: (paths: string[]): Promise<ProjectData> =>
    ipcRenderer.invoke('project:importVoiceAudioPaths', paths),
  deleteVoiceAudio: (voice: VoicePart): Promise<ProjectData> =>
    ipcRenderer.invoke('project:deleteVoiceAudio', voice),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  readProjectFile: (relPath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('project:readFile', relPath),
  acceptCountIn: (wav: Uint8Array, settings: CountInSettings): Promise<ProjectData> =>
    ipcRenderer.invoke('project:acceptCountIn', wav, settings),
  saveTake: (voice: VoicePart, webm: Uint8Array, scheduledOffsetSec: number): Promise<ProjectData> =>
    ipcRenderer.invoke('project:saveTake', voice, webm, scheduledOffsetSec),
  deleteTake: (voice: VoicePart): Promise<ProjectData> =>
    ipcRenderer.invoke('project:deleteTake', voice),
  setCrop: (crop: CropRect): Promise<ProjectData> => ipcRenderer.invoke('project:setCrop', crop),
  setQuadrantMapping: (mapping: ProjectData['quadrantMapping']): Promise<ProjectData> =>
    ipcRenderer.invoke('project:setQuadrantMapping', mapping),
  setAvOffset: (avOffsetSec: number): Promise<ProjectData> =>
    ipcRenderer.invoke('project:setAvOffset', avOffsetSec),
  getAudioInfo: (): Promise<AudioInfo | null> => ipcRenderer.invoke('project:audioInfo'),
  exportVideo: (): Promise<ExportResult> => ipcRenderer.invoke('project:export'),
  renderSyncPreview: (startSec: number, durationSec: number): Promise<PreviewResult> =>
    ipcRenderer.invoke('project:renderPreview', startSec, durationSec),
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItem', filePath)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
