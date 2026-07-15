import { useCallback, useRef } from 'react'
import { CropRect } from '@shared/types'

interface Props {
  /** Displayed size of the underlying video element, CSS pixels. */
  displayWidth: number
  displayHeight: number
  /** Crop rect in display coordinates. */
  value: CropRect
  onChange: (rect: CropRect) => void
}

const MIN_SIZE = 40

function clampRect(rect: CropRect, w: number, h: number): CropRect {
  const size = Math.max(MIN_SIZE, Math.min(rect.size, w, h))
  const x = Math.max(0, Math.min(rect.x, w - size))
  const y = Math.max(0, Math.min(rect.y, h - size))
  return { x, y, size }
}

/** Draggable, resizable square overlay. Drag to move, corner handle or mouse wheel to resize. */
export default function CropOverlay({
  displayWidth,
  displayHeight,
  value,
  onChange
}: Props): React.JSX.Element {
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    startRect: CropRect
  } | null>(null)

  const onPointerDown = useCallback(
    (mode: 'move' | 'resize') =>
      (e: React.PointerEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: value }
      },
    [value]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (drag.mode === 'move') {
        onChange(
          clampRect(
            { x: drag.startRect.x + dx, y: drag.startRect.y + dy, size: drag.startRect.size },
            displayWidth,
            displayHeight
          )
        )
      } else {
        const delta = Math.max(dx, dy)
        onChange(
          clampRect(
            { x: drag.startRect.x, y: drag.startRect.y, size: drag.startRect.size + delta },
            displayWidth,
            displayHeight
          )
        )
      }
    },
    [displayWidth, displayHeight, onChange]
  )

  const onPointerUp = useCallback((): void => {
    dragRef.current = null
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      const delta = e.deltaY < 0 ? 20 : -20
      const grown = value.size + delta
      // Zoom around the square's center.
      onChange(
        clampRect(
          {
            x: value.x - delta / 2,
            y: value.y - delta / 2,
            size: grown
          },
          displayWidth,
          displayHeight
        )
      )
    },
    [value, displayWidth, displayHeight, onChange]
  )

  return (
    <div
      className="crop-box"
      style={{ left: value.x, top: value.y, width: value.size, height: value.size }}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <div className="crop-handle" onPointerDown={onPointerDown('resize')} />
    </div>
  )
}
