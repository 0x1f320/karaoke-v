import { Assets, type Texture } from "pixi.js"
import { assetUrl } from "../../../shared/assets"

// Textures for the images the user imported. Loading is asynchronous and the
// draw loop is not, so this answers with whatever it already has and the effect
// falls back to its built-in look until the picture arrives — a frame drawn
// nothing is worse than a frame drawn the old way.
//
// One entry per file name, shared by the overlay and the settings preview: the
// same picture is one GPU upload however many effects point at it. Nothing is
// evicted, because the set is bounded by what the user has imported and a
// preset switched away from is usually switched back to.

const loaded = new Map<string, Texture>()
// Every name already asked for, including the ones that failed: a load that
// went wrong is not retried, or a missing file would be re-fetched every frame.
const asked = new Set<string>()

/** The texture for an imported image, or null until (or unless) it loads. */
export function assetTexture(name: string | null): Texture | null {
  if (!name) {
    return null
  }
  const texture = loaded.get(name)
  if (texture) {
    return texture
  }
  if (!asked.has(name)) {
    asked.add(name)
    Assets.load<Texture>(assetUrl(name))
      .then((result) => {
        loaded.set(name, result)
      })
      .catch((error) => {
        console.error(`failed to load the effect image ${name}:`, error)
      })
  }
  return null
}
