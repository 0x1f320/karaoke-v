import path from "node:path"
import { app } from "electron"

// Assets ship outside the bundle, so the packaged path is Electron's resources
// directory rather than anything relative to the compiled main process.
export function resourcePath(...parts: string[]): string {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..", "resources")
  return path.join(root, ...parts)
}
