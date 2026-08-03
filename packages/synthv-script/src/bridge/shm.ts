import { currentGroup } from "./model"
import type { NotePayload, Payload, Status, Transport } from "./types"

/**
 * Windows has no clipboard problem to solve — it has a geometry problem. There
 * is no Accessibility API to read the piano roll from, so the app needs the view
 * transform continuously rather than at transport events, and the clipboard is
 * the wrong shape for that.
 *
 * The scripting host cannot open a file or a socket, but it can allocate an
 * ArrayBuffer, and the app can read another process's memory. So this publishes
 * into one 4 MiB buffer that the app finds by scanning for the header below.
 *
 * The layout is duplicated in packages/windows-helper/src/shm.cc — change both.
 */

const SIZE = 4 * 1024 * 1024

const HDR_TOTAL_SIZE = 0x08
const HDR_VERSION = 0x0c
const HDR_EPOCH = 0x10
const HDR_HEARTBEAT = 0x18
const HDR_TICK_MS = 0x1c
const HDR_HOT_OFF = 0x20
const HDR_HOT_SIZE = 0x24
const HDR_SCHED_OFF = 0x28
const HDR_SCHED_SLOT_SIZE = 0x2c
const HDR_SCHED_ACTIVE = 0x30
const HDR_SCHED_REVISION = 0x34
const HDR_CMD_SEQ = 0x38
const HDR_CMD_ACK = 0x48

const HOT_OFF = 0x80
const HOT_SIZE = 0x80
const HOT_SEQ = 0x00
const HOT_STATUS = 0x04
const HOT_TICK_TIME = 0x08
const HOT_PLAYHEAD_SEC = 0x10
const HOT_PLAYHEAD_BLICK = 0x18
const HOT_VIEW_T0 = 0x20
const HOT_VIEW_T1 = 0x28
const HOT_VIEW_V0 = 0x30
const HOT_VIEW_V1 = 0x38
const HOT_PX_PER_BLICK = 0x40
const HOT_PX_PER_VALUE = 0x48
const HOT_X0 = 0x50
const HOT_Y0 = 0x58
const HOT_SEQ_END = 0x60

const SCHED_OFF = 0x100
const SLOT_REVISION = 0x00
const SLOT_NOTE_COUNT = 0x04
const SLOT_TIME_OFFSET = 0x08
const SLOT_PITCH_OFFSET = 0x10
const SLOT_LYRIC_OFF = 0x14
const SLOT_LYRIC_BYTES = 0x18
const SLOT_TRACK_INDEX = 0x1c
const SLOT_NOTES = 0x20

const NOTE_STRIDE = 0x30
const NOTE_ONSET_BLICK = 0x00
const NOTE_END_BLICK = 0x08
const NOTE_ONSET_SEC = 0x10
const NOTE_END_SEC = 0x18
const NOTE_PITCH = 0x20
const NOTE_LYRIC_OFF = 0x24
const NOTE_LYRIC_LEN = 0x28

const SLOT_SIZE = Math.floor((SIZE - SCHED_OFF - 8) / 16) * 8
const LYRIC_BUDGET_PER_NOTE = 64

/** The app reads the transform continuously, so this is a real tick rate. */
const TICK_MS = 16

const STATUS_CODES: Record<string, number> = {
  stopped: 0,
  playing: 1,
  looping: 2,
}

// Built from byte values on purpose: written as a string literal, the same
// sequence would also sit in this script's source text inside the very heap the
// app scans, and the app would lock onto the source copy instead of the buffer.
const MAGIC = [0x4b, 0x56, 0x2d, 0x53, 0x48, 0x4d, 0x00, 0x01]

export class ShmTransport implements Transport {
  readonly name = "shared memory"

  // Publishing costs a memory write, so the app can have the notes whether or
  // not anything is playing.
  readonly schedulesWhileStopped = true

  private readonly view: DataView
  private ticks = 0
  private revision = 0
  private activeSlot = 1
  private noteCount = 0

  constructor() {
    this.view = new DataView(new ArrayBuffer(SIZE))
    this.writeMagic(0)
    this.writeMagic(SIZE - 8)
    this.view.setUint32(HDR_TOTAL_SIZE, SIZE, true)
    this.view.setUint32(HDR_VERSION, 1, true)
    this.view.setFloat64(HDR_EPOCH, Date.now(), true)
    this.view.setUint32(HDR_TICK_MS, TICK_MS, true)
    this.view.setUint32(HDR_HOT_OFF, HOT_OFF, true)
    this.view.setUint32(HDR_HOT_SIZE, HOT_SIZE, true)
    this.view.setUint32(HDR_SCHED_OFF, SCHED_OFF, true)
    this.view.setUint32(HDR_SCHED_SLOT_SIZE, SLOT_SIZE, true)
    this.view.setUint32(HDR_SCHED_ACTIVE, this.activeSlot, true)
    this.view.setUint32(HDR_SCHED_REVISION, this.revision, true)
  }

  interval(_active: boolean): number {
    return TICK_MS
  }

  onTick(status: Status, playhead: number): void {
    this.ticks++
    this.view.setUint32(HDR_HEARTBEAT, this.ticks, true)

    const cmdSeq = this.view.getUint32(HDR_CMD_SEQ, true)
    if (cmdSeq !== this.view.getUint32(HDR_CMD_ACK, true)) {
      this.view.setUint32(HDR_CMD_ACK, cmdSeq, true)
    }

    this.writeHot(status, playhead)
  }

  send(payload: Payload): void {
    // Anchors carry no notes; the hot slot has already told the app everything
    // an anchor would.
    if (payload.notes) {
      this.publishSchedule(payload.notes)
    }
  }

  describe(): string {
    return `shared memory, rev ${this.revision} (${this.noteCount} notes)`
  }

  private writeMagic(offset: number): void {
    for (let i = 0; i < MAGIC.length; i++) {
      this.view.setUint8(offset + i, MAGIC[i])
    }
  }

  private writeUtf16(offset: number, text: string): number {
    for (let i = 0; i < text.length; i++) {
      this.view.setUint16(offset + i * 2, text.charCodeAt(i), true)
    }
    return text.length * 2
  }

  /**
   * Everything is gathered before the sequence is bumped. These are calls into
   * SynthV's own object model, not memory writes, and holding the seqlock across
   * them leaves the buffer marked "being written" for milliseconds — long enough
   * that a reader retrying in a tight loop lands inside the window every time and
   * gives up, which blanks a frame in the overlay.
   */
  private writeHot(status: Status, playheadSec: number): void {
    const nav = SV.getMainEditor().getNavigation()
    const timeAxis = SV.getProject().getTimeAxis()
    const playheadBlick = timeAxis.getBlickFromSeconds(playheadSec)
    const code = STATUS_CODES[status] ?? 0
    const timeRange = nav.getTimeViewRange()
    const valueRange = nav.getValueViewRange()
    const pxPerBlick = nav.getTimePxPerUnit()
    const pxPerValue = nav.getValuePxPerUnit()
    const x0 = nav.t2x(0)
    const y0 = nav.v2y(0)
    const now = Date.now()

    const view = this.view
    const seq = view.getUint32(HOT_OFF + HOT_SEQ, true) + 1
    view.setUint32(HOT_OFF + HOT_SEQ, seq, true)

    view.setUint32(HOT_OFF + HOT_STATUS, code, true)
    view.setFloat64(HOT_OFF + HOT_TICK_TIME, now, true)
    view.setFloat64(HOT_OFF + HOT_PLAYHEAD_SEC, playheadSec, true)
    view.setFloat64(HOT_OFF + HOT_PLAYHEAD_BLICK, playheadBlick, true)
    view.setFloat64(HOT_OFF + HOT_VIEW_T0, timeRange[0], true)
    view.setFloat64(HOT_OFF + HOT_VIEW_T1, timeRange[1], true)
    view.setFloat64(HOT_OFF + HOT_VIEW_V0, valueRange[0], true)
    view.setFloat64(HOT_OFF + HOT_VIEW_V1, valueRange[1], true)
    view.setFloat64(HOT_OFF + HOT_PX_PER_BLICK, pxPerBlick, true)
    view.setFloat64(HOT_OFF + HOT_PX_PER_VALUE, pxPerValue, true)
    view.setFloat64(HOT_OFF + HOT_X0, x0, true)
    view.setFloat64(HOT_OFF + HOT_Y0, y0, true)

    view.setUint32(HOT_OFF + HOT_SEQ, seq + 1, true)
    view.setUint32(HOT_OFF + HOT_SEQ_END, seq + 1, true)
  }

  /** Fills the inactive slot, then flips: a reader can never see a torn set. */
  private publishSchedule(notes: NotePayload[]): void {
    const view = this.view
    const slot = this.activeSlot === 0 ? 1 : 0
    const base = SCHED_OFF + slot * SLOT_SIZE
    const ref = currentGroup()

    const capacity = Math.floor((SLOT_SIZE - SLOT_NOTES) / (NOTE_STRIDE + LYRIC_BUDGET_PER_NOTE))
    const count = Math.min(notes.length, capacity)

    const poolOff = SLOT_NOTES + count * NOTE_STRIDE
    let poolCursor = poolOff

    for (let i = 0; i < count; i++) {
      const note = notes[i]
      const rec = base + SLOT_NOTES + i * NOTE_STRIDE

      view.setFloat64(rec + NOTE_ONSET_BLICK, note.onB, true)
      view.setFloat64(rec + NOTE_END_BLICK, note.offB, true)
      view.setFloat64(rec + NOTE_ONSET_SEC, note.onS, true)
      view.setFloat64(rec + NOTE_END_SEC, note.offS, true)
      view.setInt32(rec + NOTE_PITCH, note.pitch, true)

      const lyric = poolCursor + note.lyric.length * 2 > SLOT_SIZE ? "" : note.lyric
      view.setUint32(rec + NOTE_LYRIC_OFF, poolCursor, true)
      view.setUint32(rec + NOTE_LYRIC_LEN, lyric.length, true)
      poolCursor += this.writeUtf16(base + poolCursor, lyric)
    }

    this.revision++
    view.setUint32(base + SLOT_REVISION, this.revision, true)
    view.setUint32(base + SLOT_NOTE_COUNT, count, true)
    view.setFloat64(base + SLOT_TIME_OFFSET, ref ? ref.getTimeOffset() : 0, true)
    view.setInt32(base + SLOT_PITCH_OFFSET, ref ? ref.getPitchOffset() : 0, true)
    view.setUint32(base + SLOT_LYRIC_OFF, poolOff, true)
    view.setUint32(base + SLOT_LYRIC_BYTES, poolCursor - poolOff, true)
    view.setUint32(base + SLOT_TRACK_INDEX, 0, true)

    this.activeSlot = slot
    this.noteCount = count
    view.setUint32(HDR_SCHED_ACTIVE, this.activeSlot, true)
    view.setUint32(HDR_SCHED_REVISION, this.revision, true)
  }
}
