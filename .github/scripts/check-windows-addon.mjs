import assert from "node:assert/strict"
import { createRequire } from "node:module"

// Guards the module surface, not the behaviour: everything below needs a live
// SynthV to say anything, but a missing export means the addon was not actually
// rebuilt, which is a failure mode that otherwise reaches a developer's machine
// as a runtime TypeError.

const require = createRequire(import.meta.url)
const helper = require("../../packages/windows-helper/index.js")
const native = require("../../packages/windows-helper/build/Release/winhelper.node")

const EXPORTS = [
  "attach",
  "detach",
  "isAttached",
  "readState",
  "getScheduleRevision",
  "readSchedule",
  "sendCommand",
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

for (const name of EXPORTS) {
  assert.equal(typeof native[name], "function", `winhelper.node is missing ${name}()`)
  assert.equal(typeof helper[name], "function", `index.js is missing ${name}()`)
}

// Safe without SynthV running: these only report that nothing is attached.
assert.equal(helper.isAttached(), false)
assert.equal(helper.attach("no-such-process-here"), null)
assert.ok(helper.monotonicNow() > 0)

console.log(`windows-helper: ${EXPORTS.length} exports present, addon loads`)
