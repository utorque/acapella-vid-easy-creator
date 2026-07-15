/** IPC hands us Uint8Array-ish data; Web APIs want a tight ArrayBuffer. */
export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export async function readProjectAudioBuffer(
  ctx: BaseAudioContext,
  relPath: string
): Promise<AudioBuffer> {
  const raw = await window.api.readProjectFile(relPath)
  return ctx.decodeAudioData(toArrayBuffer(raw))
}

export function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
