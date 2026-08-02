import * as macHelper from "@karaoke-v/macos-helper"
import type { PianoRoll, Rect, Viewport } from "./geometry"
import * as winHelper from "@karaoke-v/windows-helper"

// One native surface for both platforms. The two helpers arrive at the same
// answers from opposite directions — macOS reads geometry out of the
// Accessibility API, Windows computes it from the bridge script's own view
// transform — but they agree on the shapes, so nothing above this line has to
// know which one is running.
//
// Importing both is deliberate: each loads its .node lazily, so the wrong-platform
// module costs a `require` of a few hundred lines of JavaScript and nothing else.

export type { PianoRoll, Rect, Viewport }

export interface NativeHelper {
  start(options: {
    target: string
    onFrame(frame: Rect): void
    onStatus(status: { state: string; mode?: string }): void
  }): void
  stop(): void
  disableAnimations(view: Buffer): void
  /** Windows only: hand the window to the OS to keep glued to the target. */
  follow?(handle: Buffer): void
  getViewport(): Viewport | null
  getPianoRoll(target?: string): PianoRoll | null
  getPianoRollAsync(target?: string): Promise<PianoRoll | null>
  monotonicNow(): number
}

export const isWindows = process.platform === "win32"

export const native: NativeHelper = (isWindows ? winHelper : macHelper) as NativeHelper

/**
 * Maps the physical screen pixels the Windows helper reports onto the DIPs
 * Electron positions windows in. Only the main process can ask Electron for it,
 * so it is computed there and pushed to the renderers.
 *
 * macOS reports points already, which is what Electron wants, so the transform
 * is the identity there and applying it is a no-op rather than a special case.
 */
export interface DipTransform {
  scale: number
  /** Physical origin of the display the transform was computed for. */
  originPx: { x: number; y: number }
  /** The same origin in DIPs. */
  originDip: { x: number; y: number }
}

export const IDENTITY_DIP: DipTransform = {
  scale: 1,
  originPx: { x: 0, y: 0 },
  originDip: { x: 0, y: 0 },
}

export function toDipX(transform: DipTransform, x: number): number {
  return transform.originDip.x + (x - transform.originPx.x) / transform.scale
}

export function toDipY(transform: DipTransform, y: number): number {
  return transform.originDip.y + (y - transform.originPx.y) / transform.scale
}

export function toDipRect(transform: DipTransform, rect: Rect): Rect {
  return {
    x: toDipX(transform, rect.x),
    y: toDipY(transform, rect.y),
    w: rect.w / transform.scale,
    h: rect.h / transform.scale,
  }
}

export function toDipViewport(transform: DipTransform, viewport: Viewport): Viewport {
  return {
    canvas: toDipRect(transform, viewport.canvas),
    contentX: toDipX(transform, viewport.contentX),
    contentW: viewport.contentW / transform.scale,
    ...(viewport.refY === undefined ? {} : { refY: toDipY(transform, viewport.refY) }),
    ...(viewport.origin === undefined
      ? {}
      : {
          origin: {
            x: toDipX(transform, viewport.origin.x),
            y: toDipY(transform, viewport.origin.y),
          },
        }),
  }
}

export function toDipPianoRoll(transform: DipTransform, read: PianoRoll): PianoRoll {
  return {
    ...read,
    ...toDipViewport(transform, read),
    refY: toDipY(transform, read.refY),
    notes: read.notes.map((note) => toDipRect(transform, note)),
  }
}
