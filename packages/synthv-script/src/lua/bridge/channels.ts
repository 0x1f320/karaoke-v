/**
 * The channels the script publishes, and the one rule that makes them safe:
 * **a record is always exactly one `write` call.**
 *
 * Measured on a regular file with a reader `pread`ing the same bytes as fast as
 * it can — 3.6M reads against a 128 B record and 271k against a 306 KB one —
 * a single write never tore. The kernel serialises reads and writes to a
 * regular file, which is the atomicity `os.rename` is usually bought for. So
 * there is no rename here, no temp file and no seqlock: build the whole record,
 * write it once.
 *
 * Two consequences that are not optional:
 *
 * - Records carry their own length. An in-place write that is shorter than the
 *   last one leaves the old tail behind, and nothing about atomicity fixes that.
 * - The stdio buffer is off. Buffered writes are not one syscall, and on the
 *   reading side a buffered handle will happily serve a stale copy — measured
 *   4.6M reads that observed a single generation.
 */

import { encodeJson, type JsonValue } from "../json"
import { channelPath } from "./paths"

/** Prefix on every record, so a reader never depends on the file's size. */
const LENGTH_DIGITS = 8

export interface Channel {
  publish(value: JsonValue): boolean
  close(): void
}

function frame(value: JsonValue): string {
  const body = encodeJson(value)
  return string.format(`%0${LENGTH_DIGITS}d%s`, string.len(body), body)
}

function open(path: string): LuaFile | undefined {
  // "r+b" keeps whatever is already there, which matters: a hot record is
  // rewritten in place and truncating would expose an empty file to a reader
  // between the truncate and the write.
  const [existing] = io.open(path, "r+b")
  if (existing !== undefined) {
    existing.setvbuf("no")
    return existing
  }
  const [created] = io.open(path, "w+b")
  if (created !== undefined) {
    created.setvbuf("no")
  }
  return created
}

/**
 * A channel whose value is only ever the latest one: the playhead, the view
 * transform. Padded to a fixed width so the record never changes size and the
 * reader can ask for exactly that many bytes.
 */
export function hotChannel(directory: string, name: string, width: number): Channel {
  const path = channelPath(directory, name)
  let handle = open(path)

  return {
    publish(value) {
      const record = frame(value)
      if (string.len(record) > width) {
        return false
      }
      if (handle === undefined) {
        handle = open(path)
        if (handle === undefined) {
          return false
        }
      }
      handle.seek("set", 0)
      const [written] = handle.write(record + string.rep(" ", width - string.len(record)))
      if (written === undefined) {
        // The app's directory can go away underneath us; reopening on the next
        // publish is the whole recovery story.
        handle.close()
        handle = undefined
        return false
      }
      return true
    },
    close() {
      if (handle !== undefined) {
        handle.close()
        handle = undefined
      }
    },
  }
}

/**
 * A channel that changes rarely and by a lot: the note schedule, the pitch
 * curves. Written whole, in one call, at offset 0 — the file only ever grows to
 * the largest record it has carried, and the length prefix makes the leftover
 * tail meaningless.
 */
export function coldChannel(directory: string, name: string): Channel {
  const path = channelPath(directory, name)
  let handle = open(path)

  return {
    publish(value) {
      if (handle === undefined) {
        handle = open(path)
        if (handle === undefined) {
          return false
        }
      }
      handle.seek("set", 0)
      const [written] = handle.write(frame(value))
      if (written === undefined) {
        handle.close()
        handle = undefined
        return false
      }
      return true
    },
    close() {
      if (handle !== undefined) {
        handle.close()
        handle = undefined
      }
    },
  }
}

/**
 * Not a channel — a directory entry that changes so the app's file watcher has
 * something it reliably notices. An in-place write to an existing file may
 * never reach `ReadDirectoryChangesW` on Windows, while a create does.
 *
 * It is a hint and only a hint: every cold channel is also announced by a
 * sequence number in the hot channel, so a missed ring costs one frame.
 */
export function doorbell(directory: string, name: string): () => void {
  const path = channelPath(directory, name)
  return () => {
    os.remove(path)
    const [file] = io.open(path, "wb")
    if (file !== undefined) {
      file.close()
    }
  }
}
