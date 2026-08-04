import assert from "node:assert/strict"
import { createRequire } from "node:module"

// Guards the module surface, not the behaviour: everything below needs a live
// SynthV to say anything, but a missing export means the addon was not actually
// rebuilt, which is a failure mode that otherwise reaches a developer's machine
// as a runtime TypeError.

const require = createRequire(import.meta.url)
const helper = require("../../packages/macos-helper/index.js")
const native = require("../../packages/macos-helper/binding.js")

// Everything the #[napi] exports register, in the camelCase napi-rs emits.
const NATIVE = [
  "start",
  "stop",
  "disableAnimations",
  "getPianoRoll",
  "getPianoRollAsync",
  "getViewport",
  "monotonicNow",
]

for (const name of NATIVE) {
  assert.equal(typeof native[name], "function", `the addon is missing ${name}()`)
  assert.equal(typeof helper[name], "function", `index.js is missing ${name}()`)
}

// Safe without SynthV running: nothing to find, so nothing is returned.
assert.equal(helper.getPianoRoll("no-such-process-here"), null)
assert.equal(await helper.getPianoRollAsync("no-such-process-here"), null)
assert.equal(helper.getViewport(), null)
assert.ok(helper.monotonicNow() > 0)

console.log(`macos-helper: addon loads, ${NATIVE.length} exports present`)
