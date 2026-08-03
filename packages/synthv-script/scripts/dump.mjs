// Prints the bridge channels a running script publishes. Binary records buy
// the editor ~17ms per edit and cost the ability to read a channel with `cat`,
// so this is how that gets paid back — and it doubles as the reference for
// what the app's reader has to do.
//
//   node scripts/dump.mjs [directory]

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const MAGIC = "KVB1"
const LAYOUT = 2
const CHANNEL = { STATE: 1, NOTES: 2 }
const STATUS = ["stopped", "playing", "looping"]

function defaultDirectory() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(local, "karaoke-v", "bridge")
  }
  return join(homedir(), "Library", "Application Support", "karaoke-v", "bridge")
}

const directory = process.argv[2] ?? defaultDirectory()

function readChannel(name, limit) {
  const path = join(directory, name)
  const size = statSync(path).size
  const length = limit === undefined ? size : Math.min(limit, size)
  const buffer = Buffer.allocUnsafe(length)
  const fd = openSync(path, "r")
  try {
    readSync(fd, buffer, 0, length, 0)
  } finally {
    closeSync(fd)
  }
  return buffer
}

class Cursor {
  constructor(buffer, offset = 0) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    this.buffer = buffer
    this.offset = offset
  }
  u8() {
    return this.view.getUint8(this.offset++)
  }
  u16() {
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }
  i16() {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }
  u32() {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }
  f64() {
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return value
  }
  /** Length-prefixed UTF-8, the `s2` of `string.pack`. */
  str() {
    const length = this.u16()
    const value = this.buffer.toString("utf8", this.offset, this.offset + length)
    this.offset += length
    return value
  }
}

const HEADER_BYTES = 12

function readHeader(cursor) {
  if (cursor.buffer.byteLength < HEADER_BYTES) {
    throw new Error("never published (the file is empty)")
  }
  const magic = cursor.buffer.toString("latin1", cursor.offset, cursor.offset + 4)
  cursor.offset += 4
  const layout = cursor.u16()
  const channel = cursor.u16()
  const length = cursor.u32()
  if (magic !== MAGIC) {
    throw new Error(`not a bridge record (magic ${JSON.stringify(magic)})`)
  }
  if (layout !== LAYOUT) {
    // Refusing beats interpreting: a fixed layout misread is silent.
    throw new Error(`unknown layout ${layout}, this reader speaks ${LAYOUT}`)
  }
  return { channel, length }
}

function decodeState(buffer) {
  const cursor = new Cursor(buffer)
  const { channel } = readHeader(cursor)
  if (channel !== CHANNEL.STATE) {
    throw new Error(`expected the state channel, got ${channel}`)
  }
  const seq = cursor.u32()
  const notesSeq = cursor.u32()
  const status = STATUS[cursor.u8()] ?? "?"
  const hasLoop = (cursor.u8() & 1) === 1
  const at = cursor.f64()
  const loopStart = cursor.f64()
  const loopEnd = cursor.f64()
  return {
    seq,
    notesSeq,
    status,
    at,
    loop: hasLoop ? { start: loopStart, end: loopEnd } : null,
    perBlick: cursor.f64(),
    perSemitone: cursor.f64(),
    viewLeft: cursor.f64(),
    viewRight: cursor.f64(),
    viewTop: cursor.f64(),
    viewBottom: cursor.f64(),
    rev: cursor.str(),
  }
}

function decodeNotes(buffer) {
  const cursor = new Cursor(buffer)
  const { channel } = readHeader(cursor)
  if (channel !== CHANNEL.NOTES) {
    throw new Error(`expected the notes channel, got ${channel}`)
  }
  const rev = cursor.str()
  const count = cursor.u32()
  const notes = []
  for (let i = 0; i < count; i++) {
    const onB = cursor.f64()
    const offB = cursor.f64()
    const onS = cursor.f64()
    const offS = cursor.f64()
    const pitch = cursor.i16()
    const lyric = cursor.str()
    const bendCount = cursor.u16()
    const bend = new Int16Array(bendCount)
    for (let b = 0; b < bendCount; b++) {
      bend[b] = cursor.i16()
    }
    notes.push({ onB, offB, onS, offS, pitch, lyric, bend })
  }
  return { rev, count, notes }
}

console.log(`directory: ${directory}\n`)

try {
  const session = JSON.parse(readFileSync(join(directory, "session.json"), "utf8"))
  console.log("session.json:", JSON.stringify(session, null, 2))
} catch (error) {
  console.log(`session.json: ${error.message}`)
}

try {
  console.log("\nstate:", decodeState(readChannel("state")))
} catch (error) {
  console.log(`\nstate: ${error.message}`)
}

try {
  const { rev, count, notes } = decodeNotes(readChannel("notes"))
  console.log(`\nnotes: rev ${rev}, ${count} notes`)
  for (const note of notes.slice(0, 8)) {
    const bend =
      note.bend.length === 0
        ? "bend none"
        : `bend ${note.bend.length} [${Math.min(...note.bend)}..${Math.max(...note.bend)}] cents` +
          ` ${Array.from(note.bend.slice(0, 6)).join(" ")}…`
    console.log(
      `  ${note.onS.toFixed(3)}s - ${note.offS.toFixed(3)}s  pitch ${note.pitch}` +
        `  ${JSON.stringify(note.lyric)}  ${bend}`,
    )
  }
  if (count > 8) {
    console.log(`  … ${count - 8} more`)
  }
} catch (error) {
  console.log(`\nnotes: ${error.message}`)
}
