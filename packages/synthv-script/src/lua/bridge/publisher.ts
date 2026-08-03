/**
 * The contract between the script and the app: which channels exist, what each
 * one carries, and how a reader pairs them up.
 *
 * Splitting the payload by how often it changes is the point — the view
 * transform moves 60 times a second while the note schedule moves when the user
 * edits, and publishing them together meant re-serialising every note to move a
 * scroll position. What it costs is that a reader can now see a schedule from
 * one generation and a transform from the next, so **every channel carries the
 * same `rev`** and the reader pairs on it.
 *
 * The hot channel doubles as the index: it names the sequence number of each
 * cold channel, so a reader that already polls it once a frame learns that the
 * schedule moved without opening anything else.
 *
 * `session.json` is the exception that stays JSON and stays padded rather than
 * framed: it is written once, it is the document that tells a reader what the
 * binary channels are and which layout they use, and it has to survive being
 * read by a person with `cat`.
 */

import { encodeJson } from "../json"
import { type Channel, coldChannel, doorbell, hotChannel } from "./channels"
import { encodeNotes, encodeState, LAYOUT, type NoteRecord } from "./codec"
import { bridgeDirectory } from "./paths"

const PROTOCOL = 1

/**
 * The hot record is padded to this, so it must fit the longest `rev` a project
 * can produce. Publishing fails rather than truncating if it ever does not.
 */
const STATE_WIDTH = 256

const SESSION_WIDTH = 1024

export interface StateValue {
  at: number
  status: string
  loop: { start: number; end: number } | null
  perBlick: number
  perSemitone: number
  viewLeft: number
  viewTop: number
  rev: string
}

export interface Publisher {
  readonly ready: boolean
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

  const session = hotChannel(directory, "session.json", SESSION_WIDTH)
  const state = hotChannel(directory, "state", STATE_WIDTH)
  const notes = coldChannel(directory, "notes")
  const ring = doorbell(directory, "doorbell")

  const host = SV.getHostInfo()
  const announced = session.publish(
    encodeJson({
      v: PROTOCOL,
      layout: LAYOUT,
      session: `${os.time()}`,
      host: {
        osType: host.osType,
        hostName: host.hostName,
        hostVersion: host.hostVersion,
        hostVersionNumber: host.hostVersionNumber,
      },
      channels: [
        { name: "state", kind: "hot", encoding: "binary", width: STATE_WIDTH },
        { name: "notes", kind: "cold", encoding: "binary" },
      ],
    }),
  )
  if (!announced) {
    // Nothing else can work either, and saying so once is more useful than
    // failing silently sixty times a second.
    closeAll([session, state, notes])
    return unavailable(`cannot write to ${directory}`)
  }

  let seq = 0
  let notesSeq = 0
  let lastError = "none"

  return {
    ready: true,

    publishState(value) {
      seq = seq + 1
      const ok = state.publish(
        encodeState({
          seq,
          notesSeq,
          at: value.at,
          status: value.status,
          loop: value.loop,
          perBlick: value.perBlick,
          perSemitone: value.perSemitone,
          viewLeft: value.viewLeft,
          viewTop: value.viewTop,
          rev: value.rev,
        }),
      )
      if (!ok) {
        lastError = "state write failed"
      }
    },

    publishNotes(rev, value) {
      notesSeq = notesSeq + 1
      if (!notes.publish(encodeNotes(rev, value))) {
        lastError = "notes write failed"
        return
      }
      ring()
    },

    describe() {
      return `${directory} (seq ${seq}, notes ${notesSeq}, last error: ${lastError})`
    },

    close() {
      closeAll([session, state, notes])
    },
  }
}

function closeAll(channels: Channel[]): void {
  for (const channel of channels) {
    channel.close()
  }
}

function unavailable(reason: string): Publisher {
  return {
    ready: false,
    publishState: () => {},
    publishNotes: () => {},
    describe: () => `unavailable: ${reason}`,
    close: () => {},
  }
}
