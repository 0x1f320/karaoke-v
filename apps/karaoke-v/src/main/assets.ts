import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron"
import { ASSET_DIR, ASSET_EXTENSIONS, ASSET_SCHEME, isAssetName } from "../shared/assets"
import { t } from "./i18n"

// Images the effects draw. An import is copied into userData, named after its
// own content, and handed back as a bare file name — so preferences stay small,
// the same picture imported twice costs one file, and a renderer never sees a
// path it could reach outside the directory with.

/** Bigger than this is a photo, not a sprite; the GPU upload is the cost. */
const MAX_BYTES = 32 * 1024 * 1024

function assetDir(): string {
  return path.join(app.getPath("userData"), ASSET_DIR)
}

/**
 * Must run before the app is ready, or the scheme stays a plain one.
 *
 * `corsEnabled` is the one that decides whether this works at all: a window is
 * served from http (the dev server) or file (packaged), so every asset:// read
 * is cross-origin, and without it `fetch` is refused. Pixi loads a texture by
 * fetching it — in a worker at that — so the refusal would surface only as an
 * effect that quietly goes on drawing its built-in shape. An <img> tag is not
 * held to the same rule, so the settings thumbnail would appear regardless.
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

async function importAsset(parent: BrowserWindow | null): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    ...(parent ? { parent, modal: true } : {}),
    properties: ["openFile"],
    filters: [{ name: t("settings.effects.image.filter"), extensions: [...ASSET_EXTENSIONS] }],
  })
  const source = picked.filePaths[0]
  if (picked.canceled || !source) {
    return null
  }

  const extension = path.extname(source).slice(1).toLowerCase()
  if (!(ASSET_EXTENSIONS as readonly string[]).includes(extension)) {
    return null
  }
  const data = await fs.readFile(source)
  if (data.byteLength > MAX_BYTES) {
    throw new Error(`image is too large: ${data.byteLength} bytes`)
  }

  const name = `${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${extension}`
  const target = path.join(assetDir(), name)
  await fs.mkdir(assetDir(), { recursive: true })
  // Content-addressed: an existing file is byte for byte this one, and
  // rewriting it would only tear a texture some window is already drawing.
  await fs.writeFile(target, data, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") {
      throw error
    }
  })
  return name
}

export function registerAssetIpc(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = path.basename(new URL(request.url).pathname)
    if (!isAssetName(name)) {
      return new Response(null, { status: 400 })
    }
    return net.fetch(pathToFileURL(path.join(assetDir(), name)).toString())
  })

  ipcMain.handle("assets:import", (event) =>
    importAsset(BrowserWindow.fromWebContents(event.sender)),
  )
}
