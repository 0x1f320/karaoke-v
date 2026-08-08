import { encodeJson } from "../json"
import { SCRIPT_VERSION } from "../version"
import {
  encodeNotes,
  encodeScroll,
  encodeSession,
  encodeState,
  LAYOUT,
  type NoteRecord,
} from "./codec"
import { bridgeDirectory } from "./paths"
import { createPipeClient } from "./pipe"

const PROTOCOL = 1

export interface StateValue {
  at: number
  status: string
  loop: { start: number; end: number } | null
  perBlick: number
  perSemitone: number
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
  rev: string
}

interface ScrollValue {
  perBlick: number
  perSemitone: number
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
}

export type PrepareResult = "new-session" | "connected" | "disconnected"

export interface Publisher {
  prepare(elapsedMs: number): PrepareResult
  publishState(state: StateValue): void
  publishNotes(rev: string, notes: NoteRecord[]): void
  describe(): string
  close(): void
}

export function createPublisher(): Publisher {
  const directory = bridgeDirectory()
  if (directory === undefined) {
    return unavailable("no home directory")
  }

  const client = createPipeClient(directory)
  const scriptStartedAt = os.time()
  const host = SV.getHostInfo()
  let connectionCounter = 0
  let activeConnectionSerial: number | undefined
  let appSession = "none"
  let scriptSession = "none"
  let seq = 0
  let notesSeq = 0
  let scrollSeq = 0
  let lastScroll: ScrollValue | null = null
  let lastError = "none"

  function resetPublicationState(): void {
    seq = 0
    notesSeq = 0
    scrollSeq = 0
    lastScroll = null
  }

  function deactivate(message: string): void {
    activeConnectionSerial = undefined
    lastError = message
  }

  return {
    prepare(elapsedMs) {
      const connection = client.connect(elapsedMs)
      if (connection === undefined) {
        activeConnectionSerial = undefined
        return "disconnected"
      }
      if (connection.serial === activeConnectionSerial) {
        return "connected"
      }

      resetPublicationState()
      connectionCounter = connectionCounter + 1
      appSession = connection.session
      scriptSession = `${scriptStartedAt}:${connectionCounter}`
      const sessionFrame = encodeSession(
        encodeJson({
          v: PROTOCOL,
          layout: LAYOUT,
          appSession,
          scriptSession,
          scriptVersion: SCRIPT_VERSION,
          host: {
            osType: host.osType,
            hostName: host.hostName,
            hostVersion: host.hostVersion,
            hostVersionNumber: host.hostVersionNumber,
          },
        }),
      )
      if (!client.write("state", sessionFrame)) {
        deactivate("session write failed")
        client.disconnect()
        return "disconnected"
      }

      activeConnectionSerial = connection.serial
      lastError = "none"
      return "new-session"
    },

    publishState(value) {
      if (activeConnectionSerial === undefined) {
        return
      }

      const nextScroll = scrollValue(value)
      if (lastScroll === null || !sameScroll(lastScroll, nextScroll)) {
        const nextScrollSeq = scrollSeq + 1
        if (!client.write("scroll", encodeScroll({ scrollSeq: nextScrollSeq, ...nextScroll }))) {
          deactivate("scroll write failed")
          return
        }
        scrollSeq = nextScrollSeq
        lastScroll = nextScroll
      }

      const nextSeq = seq + 1
      if (
        !client.write(
          "state",
          encodeState({
            seq: nextSeq,
            notesSeq,
            scrollSeq,
            at: value.at,
            status: value.status,
            loop: value.loop,
            rev: value.rev,
          }),
        )
      ) {
        deactivate("state write failed")
        return
      }
      seq = nextSeq
    },

    publishNotes(rev, notes) {
      if (activeConnectionSerial === undefined) {
        return
      }
      const nextNotesSeq = notesSeq + 1
      if (!client.write("notes", encodeNotes(nextNotesSeq, rev, notes))) {
        deactivate("notes write failed")
        return
      }
      notesSeq = nextNotesSeq
    },

    describe() {
      return `${directory} (${client.describe()}, app ${appSession}, script ${scriptSession}, seq ${seq}, scroll ${scrollSeq}, notes ${notesSeq}, last error: ${lastError})`
    },

    close() {
      activeConnectionSerial = undefined
      client.disconnect()
    },
  }
}

function scrollValue(value: StateValue): ScrollValue {
  return {
    perBlick: value.perBlick,
    perSemitone: value.perSemitone,
    viewLeft: value.viewLeft,
    viewRight: value.viewRight,
    viewTop: value.viewTop,
    viewBottom: value.viewBottom,
  }
}

function sameScroll(left: ScrollValue, right: ScrollValue): boolean {
  return (
    left.perBlick === right.perBlick &&
    left.perSemitone === right.perSemitone &&
    left.viewLeft === right.viewLeft &&
    left.viewRight === right.viewRight &&
    left.viewTop === right.viewTop &&
    left.viewBottom === right.viewBottom
  )
}

function unavailable(reason: string): Publisher {
  return {
    prepare: () => "disconnected",
    publishState: () => {},
    publishNotes: () => {},
    describe: () => `disconnected, last error: ${reason}`,
    close: () => {},
  }
}
