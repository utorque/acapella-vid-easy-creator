import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import { CountInSettings, CropRect, ProjectData, VoicePart } from '@shared/types'
import * as project from './project'
import { exportVideo, renderSyncPreview } from './export'

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('project:create', async (event, name: string) => {
    const win = windowOf(event)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose where to create the project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return project.createProject(result.filePaths[0], name)
  })

  ipcMain.handle('project:open', async (event) => {
    const win = windowOf(event)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a project (select its project.json)',
      properties: ['openFile'],
      filters: [{ name: 'Project', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return project.openProject(path.dirname(result.filePaths[0]))
  })

  ipcMain.handle('project:openPath', async (_event, dir: string) => {
    return project.openProject(dir)
  })

  ipcMain.handle('project:importAudio', async (event) => {
    const win = windowOf(event)
    const { dir } = project.getCurrent()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import the final mixed audio track',
      defaultPath: dir,
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return project.importAudio(result.filePaths[0])
  })

  ipcMain.handle('project:importVoiceAudioDialog', async (event) => {
    const win = windowOf(event)
    const { dir } = project.getCurrent()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import per-voice reference audio (name files with ten/lead/bari/bass)',
      defaultPath: dir,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return project.importVoiceAudioFiles(result.filePaths)
  })

  ipcMain.handle('project:importVoiceAudioPaths', async (_event, paths: string[]) => {
    return project.importVoiceAudioFiles(paths)
  })

  ipcMain.handle('project:deleteVoiceAudio', async (_event, voice: VoicePart) => {
    return project.deleteVoiceAudio(voice)
  })

  ipcMain.handle('project:readFile', async (_event, relPath: string) => {
    return project.readProjectFile(relPath)
  })

  ipcMain.handle(
    'project:acceptCountIn',
    async (_event, wav: Uint8Array, settings: CountInSettings) => {
      return project.acceptCountIn(wav, settings)
    }
  )

  ipcMain.handle(
    'project:saveTake',
    async (_event, voice: VoicePart, webm: Uint8Array, scheduledOffsetSec: number) => {
      return project.saveTake(voice, webm, scheduledOffsetSec)
    }
  )

  ipcMain.handle('project:deleteTake', async (_event, voice: VoicePart) => {
    return project.deleteTake(voice)
  })

  ipcMain.handle('project:setCrop', async (_event, crop: CropRect) => {
    return project.setCrop(crop)
  })

  ipcMain.handle(
    'project:setQuadrantMapping',
    async (_event, mapping: ProjectData['quadrantMapping']) => {
      return project.setQuadrantMapping(mapping)
    }
  )

  ipcMain.handle('project:setAvOffset', async (_event, avOffsetSec: number) => {
    return project.setAvOffset(avOffsetSec)
  })

  ipcMain.handle('project:audioInfo', async () => {
    return project.getOriginalAudioInfo()
  })

  ipcMain.handle('project:export', async (event) => {
    const win = windowOf(event)
    return exportVideo((p) => {
      win?.webContents.send('export:progress', p)
    })
  })

  ipcMain.handle(
    'project:renderPreview',
    async (event, startSec: number, durationSec: number) => {
      const win = windowOf(event)
      return renderSyncPreview(
        (p) => {
          win?.webContents.send('export:progress', p)
        },
        startSec,
        durationSec
      )
    }
  )

  ipcMain.handle('shell:showItem', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
