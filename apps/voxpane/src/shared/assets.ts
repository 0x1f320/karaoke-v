// Images the user imports for the effects. Preferences only ever carry the
// stored file name; main owns the directory and serves it back over a scheme of
// its own, so nothing binary is ever written into preferences.json.

export const ASSET_SCHEME = "asset"

/** Where main keeps the imported copies, under userData. */
export const ASSET_DIR = "effect-assets"

export const ASSET_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif"] as const

// The name is a stored file name that reaches disk and a URL, and it arrives
// from preferences.json, so it is checked rather than trusted: a hash and one
// known extension, which no path separator or "." can pass.
const ASSET_NAME = new RegExp(`^[0-9a-f]{16}\\.(${ASSET_EXTENSIONS.join("|")})$`)

export function isAssetName(value: unknown): value is string {
  return typeof value === "string" && ASSET_NAME.test(value)
}

export function assetUrl(name: string): string {
  return `${ASSET_SCHEME}://effects/${name}`
}
