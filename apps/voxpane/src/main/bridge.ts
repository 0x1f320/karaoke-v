import { mkdirSync } from "node:fs"
import { bridgeDirectory } from "../shared/bridgePath"

// The preload worker owns bridge endpoints and their lifecycle. Main only
// prepares the directory because SynthV's Lua host cannot create it.

export function prepareBridgeDirectory(): void {
  mkdirSync(bridgeDirectory(), { recursive: true })
}
