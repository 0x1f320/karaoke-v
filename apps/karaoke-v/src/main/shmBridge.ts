import * as winHelper from "@karaoke-v/windows-helper"
import type {
  BridgeMessage,
  BridgeNote,
  BridgePayload,
  BridgeStatus,
} from "../shared/bridge"

// The Windows half of the bridge. macOS receives finished payloads over the
// clipboard; here the script publishes raw state into shared memory instead, and
// the transport events the rest of the app reacts to are derived from watching
// that state change.
//
// The wire format stays identical on purpose. Everything downstream — the
// transport clock, the note lookup, the effects — was written against payloads,
// and none of it should have to learn that one platform pushes while the other
// is polled.

const STATUSES: BridgeStatus[] = ["stopped", "playing", "looping"]

/** Matches the script's tick, so a transport change is seen within one tick. */
const POLL_MS = 16

/**
 * A playhead that moved further than this from where the local clock expected it
 * did not get there by playing: it was seeked, or a loop wrapped. Generous enough
 * to absorb a slow poll, tight enough that a wrap in a short loop still trips it.
 */
const DISCONTINUITY_SEC = 0.25

interface Watcher {
  stop(): void
}

function toNotes(schedule: winHelper.Schedule): BridgeNote[] {
  return schedule.notes.map((note) => ({
    onB: note.onsetBlick,
    offB: note.endBlick,
    onS: note.onsetSec,
    offS: note.endSec,
    pitch: note.pitch,
    lyric: note.lyric,
  }))
}

export function startShmBridge(
  emit: (message: BridgeMessage) => void,
  target = "synthv-studio",
): Watcher {
  let notes: BridgeNote[] = []
  let revision = -1
  let status: BridgeStatus = "stopped"
  let lastPlayhead = 0
  let lastClockMs = 0

  const send = (
    kind: BridgePayload["kind"],
    state: winHelper.BridgeState,
    withNotes: boolean,
  ): void => {
    const payload: BridgePayload = {
      v: 1,
      kind,
      at: state.playheadSec,
      status,
      px: {
        perBlick: state.pxPerBlick,
        perSemitone: state.pxPerValue,
        viewLeft: state.viewT0,
        viewTop: state.viewV1,
      },
      // SynthV's script API can set a loop but never read one back, so the
      // bounds stay unknown here exactly as they are on macOS.
      loop: null,
      rev: String(revision),
      ...(withNotes ? { notes } : {}),
    }
    emit({ payload, monotonicMs: winHelper.monotonicNow() })
  }

  const poll = (): void => {
    // The helper attaches (and reattaches) on demand, so a bridge that has not
    // started yet, or one that died because the scripts menu was rescanned, is
    // an ordinary null here rather than something to recover from.
    const state = winHelper.readState(target)
    if (!state) {
      return
    }

    const nextStatus = STATUSES[state.status] ?? "stopped"
    const nowMs = winHelper.monotonicNow()

    const nextRevision = winHelper.getScheduleRevision()
    const scheduleChanged = nextRevision !== null && nextRevision !== revision
    if (scheduleChanged) {
      const schedule = winHelper.readSchedule()
      if (schedule) {
        notes = toNotes(schedule)
        revision = schedule.revision
      }
    }

    const started = nextStatus !== "stopped" && status === "stopped"
    const stopped = nextStatus === "stopped" && status !== "stopped"
    const expected =
      status === "stopped" ? lastPlayhead : lastPlayhead + (nowMs - lastClockMs) / 1000
    const jumped =
      !started && !stopped && Math.abs(state.playheadSec - expected) > DISCONTINUITY_SEC

    status = nextStatus
    lastPlayhead = state.playheadSec
    lastClockMs = nowMs

    if (started) {
      send("start", state, true)
    } else if (stopped) {
      send("stop", state, false)
    } else if (scheduleChanged) {
      send("edit", state, true)
    } else if (jumped) {
      send("anchor", state, false)
    }
  }

  const timer = setInterval(poll, POLL_MS)
  poll()

  return {
    stop(): void {
      clearInterval(timer)
      winHelper.detach()
    },
  }
}
