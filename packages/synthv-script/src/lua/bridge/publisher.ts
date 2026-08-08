/**
 * The contract between the script and the app: which channels exist, what each
 * one carries, and how a reader pairs them up.
 *
 * Splitting the payload by how often it changes is the point: transport changes
 * every tick, the view transform changes while scrolling or zooming, and the
 * note schedule changes after edits.
 *
 * The state channel doubles as the index: it names the sequence number of each
 * slower channel, so a reader that already polls it learns that a transform or
 * schedule moved without opening either while unchanged. That is also why there
 * is no notification of any kind here — a watcher cannot beat "the app already looks
 * every frame", and measured, its tail latency is far worse.
 *
 * `session.json` is the exception that stays JSON and stays padded rather than
 * framed: it is written once, it is the document that tells a reader what the
 * binary channels are and which layout they use, and it has to survive being
 * read by a person with `cat`.
 */

import { encodeJson } from "../json"
import { type Channel, coldChannel, hotChannel } from "./channels"
import { encodeNotes, encodeScroll, encodeState, LAYOUT, type NoteRecord } from "./codec"
import { bridgeDirectory } from "./paths"

const PROTOCOL = 1

/**
 * The hot record is padded to this, so it must fit the longest `rev` a project
 * can produce. Publishing fails rather than truncating if it ever does not.
 */
const STATE_WIDTH = 256
const SCROLL_WIDTH = 64

const SESSION_WIDTH = 1024

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
  const scroll = hotChannel(directory, "scroll", SCROLL_WIDTH)
  const notes = coldChannel(directory, "notes")

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
        { name: "scroll", kind: "hot", encoding: "binary", width: SCROLL_WIDTH },
        { name: "notes", kind: "cold", encoding: "binary" },
      ],
    }),
  )
  if (!announced) {
    // Nothing else can work either, and saying so once is more useful than
    // failing silently sixty times a second.
    closeAll([session, state, scroll, notes])
    return unavailable(`cannot write to ${directory}`)
  }

  let seq = 0
  let notesSeq = 0
  let scrollSeq = 0
  let lastScroll: ScrollValue | null = null
  let lastError = "none"

  return {
    ready: true,

    publishState(value) {
      const nextScroll = scrollValue(value)
      if (lastScroll === null || !sameScroll(lastScroll, nextScroll)) {
        const nextScrollSeq = scrollSeq + 1
        const ok = scroll.publish(encodeScroll({ scrollSeq: nextScrollSeq, ...nextScroll }))
        if (ok) {
          scrollSeq = nextScrollSeq
          lastScroll = nextScroll
        } else {
          lastError = "scroll write failed"
        }
      }

      seq = seq + 1
      const ok = state.publish(
        encodeState({
          seq,
          notesSeq,
          scrollSeq,
          at: value.at,
          status: value.status,
          loop: value.loop,
          rev: value.rev,
        }),
      )
      if (!ok) {
        lastError = "state write failed"
      }
    },

    publishNotes(rev, value) {
      if (notes.publish(encodeNotes(notesSeq + 1, rev, value))) {
        notesSeq = notesSeq + 1
      } else {
        lastError = "notes write failed"
      }
    },

    describe() {
      return `${directory} (seq ${seq}, scroll ${scrollSeq}, notes ${notesSeq}, last error: ${lastError})`
    },

    close() {
      closeAll([session, state, scroll, notes])
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
