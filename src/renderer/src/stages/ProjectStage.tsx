import { useState } from 'react'
import { ProjectData } from '@shared/types'

interface Props {
  projectDir: string | null
  data: ProjectData | null
  onProject: (dir: string, data: ProjectData) => void
  onData: (data: ProjectData) => void
}

export default function ProjectStage({ projectDir, data, onProject, onData }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stage">
      <h2>Project</h2>
      <div className="card">
        <div className="row">
          <label className="field">
            New project name
            <input
              type="text"
              value={name}
              placeholder="e.g. sweet-adeline"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() =>
              run(async () => {
                const result = await window.api.createProject(name)
                if (result) onProject(result.dir, result.data)
              })
            }
          >
            Create project…
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await window.api.openProject()
                if (result) onProject(result.dir, result.data)
              })
            }
          >
            Open existing…
          </button>
        </div>
        {projectDir && (
          <p className="hint mono">
            Project folder: {projectDir}
          </p>
        )}
      </div>

      {data && (
        <div className="card">
          <h2>Mixed audio track</h2>
          <p className="hint">
            Import the final mixed track (the full arrangement you will sing along to). Audio
            mixing itself happens outside this app.
          </p>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const updated = await window.api.importAudio()
                  if (updated) onData({ ...updated })
                })
              }
            >
              {data.originalAudio ? 'Replace track…' : 'Import track…'}
            </button>
            {data.originalAudio && <span className="ok-text mono">✓ {data.originalAudio}</span>}
          </div>
          {data.originalAudio && !data.pickupAudio && (
            <p className="hint">Next: generate the count-in in step 2.</p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
