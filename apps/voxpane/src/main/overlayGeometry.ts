import { ipcMain } from "electron"
import type { CanvasSnapshot } from "../shared/geometry"
import { NATIVE_TARGET, type NativeHelper, native, toDipCanvasSnapshot } from "../shared/native"
import { getDipTransform } from "./dip"

interface OverlayGeometryIpc {
  handle(channel: string, handler: () => unknown): void
}

export function createOverlayCanvasReader(
  helper: Partial<NativeHelper> = native,
  target = NATIVE_TARGET,
  transform = getDipTransform,
): () => Promise<CanvasSnapshot | null> {
  let seeded = false
  let failures = 0

  return async () => {
    const cached = (await helper.getCanvasAsync?.()) ?? null
    if (cached) {
      seeded = true
      failures = 0
      return toDipCanvasSnapshot(transform(), { canvas: cached, origin: { x: 0, y: 0 } })
    }

    failures += 1
    if (seeded && failures < 4) {
      return null
    }

    const seededRead = (await helper.getPianoRollAsync?.(target)) ?? null
    if (!seededRead) {
      return null
    }

    seeded = true
    failures = 0
    const canvas = (await helper.getCanvasAsync?.()) ?? null
    return toDipCanvasSnapshot(
      transform(),
      canvas ? { canvas, origin: { x: 0, y: 0 } } : seededRead,
    )
  }
}

export function registerOverlayGeometryIpc(
  ipc: OverlayGeometryIpc = ipcMain,
  helper: Partial<NativeHelper> = native,
  target = NATIVE_TARGET,
): void {
  const readCanvas = createOverlayCanvasReader(helper, target)
  ipc.handle("overlay:getCanvas", () => readCanvas())
}
