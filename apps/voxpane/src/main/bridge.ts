import { mkdirSync } from "node:fs"
import { bridgeDirectory } from "../shared/bridgePath"

// All main does for the bridge now is make the place where it happens.
//
// The script writes its channels into this directory and the renderer reads
// them there, with nothing in between — no receiver, no IPC fan-out, no
// per-platform transport. What is left in main is the one thing the script
// cannot do: create the directory. It runs inside SynthV's Lua host, which has
// no mkdir, and the only way to get one there is to spawn a shell from inside a
// DAW.
//
// Creating it early also means the script can be running first: it retries its
// open on every tick, so the order the two are started in does not matter.

export function prepareBridgeDirectory(): void {
  mkdirSync(bridgeDirectory(), { recursive: true })
}
