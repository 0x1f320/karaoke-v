import assert from "node:assert/strict"
import { createRequire } from "node:module"

// Guards the module surface, not the behaviour: everything below needs a live
// SynthV to say anything, but a missing export means the addon was not actually
// rebuilt, which is a failure mode that otherwise reaches a developer's machine
// as a runtime TypeError.

const require = createRequire(import.meta.url)
const helper = require("../../packages/windows-helper/index.js")
const native = require("../../packages/windows-helper/binding.js")

// Everything the #[napi] exports register, in the camelCase napi-rs emits.
const NATIVE = [
  "findCanvas",
  "getCanvasRect",
  "getTargetOrigin",
  "listElements",
  "start",
  "stop",
  "follow",
  "unfollow",
  "getTargetFrame",
  "disableAnimations",
  "monotonicNow",
]

// The public surface, which is deliberately not the native one: findCanvas and
// getCanvasRect stay internal behind the caching getCanvas.
const PUBLIC = [
  "getCanvas",
  "getCanvasOrigin",
  "start",
  "stop",
  "follow",
  "unfollow",
  "getTargetFrame",
  "getTargetOrigin",
  "disableAnimations",
  "monotonicNow",
  "listElements",
]

for (const name of NATIVE) {
  assert.equal(typeof native[name], "function", `the addon is missing ${name}()`)
}
for (const name of PUBLIC) {
  assert.equal(typeof helper[name], "function", `index.js is missing ${name}()`)
}

// Safe without SynthV running: nothing to find, so nothing is returned.
assert.equal(helper.getCanvas({ width: 800, height: 600 }, "no-such-process-here"), null)
assert.equal(helper.getCanvasOrigin(), undefined)
assert.equal(helper.getTargetFrame("no-such-process-here"), null)
assert.ok(helper.monotonicNow() > 0)

console.log(
  `windows-helper: addon loads, ${NATIVE.length} native and ${PUBLIC.length} public exports present`,
)
