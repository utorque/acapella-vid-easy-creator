import { useMemo, useState } from 'react'
import { ProjectData, VOICE_PARTS } from '@shared/types'
import ProjectStage from './stages/ProjectStage'
import PickupStage from './stages/PickupStage'
import CaptureStage from './stages/CaptureStage'
import CropStage from './stages/CropStage'
import ColorStage from './stages/ColorStage'
import ExportStage from './stages/ExportStage'

export type StageId = 'project' | 'pickup' | 'capture' | 'crop' | 'color' | 'export'

interface StageDef {
  id: StageId
  label: string
  enabled: (data: ProjectData | null) => boolean
  /** True once this stage's own work is finished (drives the Next button). */
  done: (data: ProjectData | null) => boolean
  hint: string
}

const STAGES: StageDef[] = [
  {
    id: 'project',
    label: '1 · Project',
    enabled: () => true,
    done: (d) => !!d?.originalAudio,
    hint: ''
  },
  {
    id: 'pickup',
    label: '2 · Count-in',
    enabled: (d) => !!d?.originalAudio,
    done: (d) => !!d?.pickupAudio,
    hint: 'Import the mixed track first'
  },
  {
    id: 'capture',
    label: '3 · Capture',
    enabled: (d) => !!d?.pickupAudio,
    done: (d) => !!d && VOICE_PARTS.every((v) => !!d.takes[v]),
    hint: 'Generate the count-in first'
  },
  {
    id: 'crop',
    label: '4 · Crop',
    enabled: (d) => !!d && Object.keys(d.takes).length > 0,
    done: (d) => !!d?.crop,
    hint: 'Record at least one take first'
  },
  {
    id: 'color',
    label: '5 · Color',
    enabled: (d) => !!d && !!d.crop && VOICE_PARTS.every((v) => !!d.takes[v]),
    done: (d) => !!d?.colorCorrection,
    hint: 'Record all four parts and set the crop first'
  },
  {
    id: 'export',
    label: '6 · Export',
    enabled: (d) =>
      !!d && !!d.crop && VOICE_PARTS.every((v) => !!d.takes[v]) && !!d.colorCorrection,
    done: () => false,
    hint: 'Finish the color consistency step first'
  }
]

export default function App(): React.JSX.Element {
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [data, setData] = useState<ProjectData | null>(null)
  const [stage, setStage] = useState<StageId>('project')

  const stageDefs = useMemo(() => STAGES, [])

  const stageIndex = stageDefs.findIndex((s) => s.id === stage)
  const current = stageDefs[stageIndex]
  const next = stageDefs[stageIndex + 1]
  const showNext = !!next && current.done(data) && next.enabled(data)

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          A Cappella Video Creator
          {data && <span className="project-name"> — {data.name}</span>}
        </div>
        <nav className="stage-nav">
          {stageDefs.map((s) => {
            const enabled = s.enabled(data)
            return (
              <button
                key={s.id}
                className={`stage-tab ${stage === s.id ? 'active' : ''}`}
                disabled={!enabled}
                title={enabled ? undefined : s.hint}
                onClick={() => setStage(s.id)}
              >
                {s.label}
              </button>
            )
          })}
        </nav>
      </header>
      <main className="stage-body">
        {stage === 'project' && (
          <ProjectStage
            projectDir={projectDir}
            data={data}
            onProject={(dir, d) => {
              setProjectDir(dir)
              setData(d)
            }}
            onData={setData}
          />
        )}
        {stage === 'pickup' && data && <PickupStage data={data} onData={setData} />}
        {stage === 'capture' && data && <CaptureStage data={data} onData={setData} />}
        {stage === 'crop' && data && <CropStage data={data} onData={setData} />}
        {stage === 'color' && data && <ColorStage data={data} onData={setData} />}
        {stage === 'export' && data && <ExportStage data={data} onData={setData} />}
        {showNext && (
          <button className="next-fab" onClick={() => setStage(next.id)}>
            Next: {next.label} →
          </button>
        )}
      </main>
    </div>
  )
}
