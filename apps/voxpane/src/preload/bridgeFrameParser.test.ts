import { describe, expect, it } from "vitest"
import {
  BRIDGE_CHANNEL_NOTES,
  BRIDGE_CHANNEL_SCROLL,
  BRIDGE_CHANNEL_STATE,
  BRIDGE_HEADER_BYTES,
  BRIDGE_LAYOUT,
} from "../shared/bridgeChannels"
import { BridgeFrameParser, type BridgeFramePolicy } from "./bridgeFrameParser"

const MAGIC = 0x31425056
const MAX_NOTES_PAYLOAD_BYTES = 64 * 1024 * 1024

const STATE_POLICY: BridgeFramePolicy = {
  allowedChannels: [BRIDGE_CHANNEL_STATE],
  maximumPayloadBytes: { [BRIDGE_CHANNEL_STATE]: 256 },
}

const NOTES_POLICY: BridgeFramePolicy = {
  allowedChannels: [BRIDGE_CHANNEL_NOTES],
  maximumPayloadBytes: { [BRIDGE_CHANNEL_NOTES]: MAX_NOTES_PAYLOAD_BYTES },
}

const MULTI_CHANNEL_POLICY: BridgeFramePolicy = {
  allowedChannels: [BRIDGE_CHANNEL_STATE, BRIDGE_CHANNEL_NOTES],
  maximumPayloadBytes: {
    [BRIDGE_CHANNEL_STATE]: 256,
    [BRIDGE_CHANNEL_NOTES]: MAX_NOTES_PAYLOAD_BYTES,
  },
}

function stateParser(): BridgeFrameParser {
  return new BridgeFrameParser(STATE_POLICY)
}

function notesParser(): BridgeFrameParser {
  return new BridgeFrameParser(NOTES_POLICY)
}

function frame(channel: number, payload: Uint8Array): Uint8Array {
  return header(channel, payload.length, payload)
}

function header(
  channel: number,
  length: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const bytes = new Uint8Array(BRIDGE_HEADER_BYTES + payload.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint16(4, BRIDGE_LAYOUT, true)
  view.setUint16(6, channel, true)
  view.setUint32(8, length, true)
  bytes.set(payload, BRIDGE_HEADER_BYTES)
  return bytes
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

describe("BridgeFrameParser", () => {
  it("accepts a state frame split at every header and payload boundary", () => {
    const expected = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(4, 8, 15, 16))

    for (let split = 0; split <= expected.length; split += 1) {
      const parser = stateParser()

      expect(parser.push(expected.subarray(0, split))).toEqual(
        split === expected.length ? [expected] : [],
      )
      expect(parser.push(expected.subarray(split))).toEqual(
        split === expected.length ? [] : [expected],
      )
    }
  })

  it("accepts empty chunks, coalesced frames, and a complete frame before a trailing partial frame", () => {
    const first = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1))
    const second = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(2, 3))
    const parser = stateParser()

    expect(parser.push(new Uint8Array(0))).toEqual([])
    expect(parser.push(concat(first, second))).toEqual([first, second])
    expect(parser.push(concat(first, second.subarray(0, 5)))).toEqual([first])
    expect(parser.push(second.subarray(5))).toEqual([second])
  })

  it("returns copied frames from sliced caller buffers", () => {
    const expected = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(9, 8, 7))
    const backing = new Uint8Array(expected.length + 8)
    backing.set(expected, 4)
    const input = backing.subarray(4, 4 + expected.length)
    const parser = stateParser()

    expect(parser.push(input.subarray(0, 7))).toEqual([])
    const received = parser.push(input.subarray(7))

    expect(received).toEqual([expected])
    expect(received?.[0]).not.toBe(input)
    backing.fill(0, 4, 4 + expected.length)
    expect(received).toEqual([expected])
  })

  it("accepts a zero-length payload", () => {
    const expected = frame(BRIDGE_CHANNEL_STATE, new Uint8Array(0))

    expect(stateParser().push(expected)).toEqual([expected])
  })

  it("lets a valid policy discard a partial frame on reset", () => {
    const parser = stateParser()
    const expected = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1, 2))

    expect(parser.push(expected.subarray(0, 5))).toEqual([])
    parser.reset()
    expect(parser.push(expected)).toEqual([expected])
  })

  it("rejects malformed headers permanently without scanning for later frames", () => {
    const malformed = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1))
    malformed[0] = 0
    const valid = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(2))
    const parser = stateParser()
    let result: Uint8Array[] | null = []

    expect(() => {
      result = parser.push(concat(malformed, valid))
    }).not.toThrow()
    expect(result).toBeNull()
    expect(parser.push(valid)).toBeNull()
    parser.reset()
    expect(parser.push(valid)).toEqual([valid])
  })

  it("rejects wrong layouts and channels that its policy does not allow", () => {
    const wrongLayout = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1))
    new DataView(wrongLayout.buffer).setUint16(4, BRIDGE_LAYOUT - 1, true)

    expect(stateParser().push(wrongLayout)).toBeNull()
    expect(stateParser().push(frame(BRIDGE_CHANNEL_SCROLL, Uint8Array.of(1)))).toBeNull()
    expect(stateParser().push(frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(1)))).toBeNull()
  })

  it("rejects payload lengths above their channel cap before receiving a payload", () => {
    const oversized = header(BRIDGE_CHANNEL_NOTES, MAX_NOTES_PAYLOAD_BYTES + 1)

    expect(notesParser().push(oversized)).toBeNull()
  })

  it("rejects an allowed channel without an explicit payload cap", () => {
    const parser = new BridgeFrameParser({
      allowedChannels: [BRIDGE_CHANNEL_STATE],
      maximumPayloadBytes: {} as Readonly<Record<number, number>>,
    })

    expect(parser.push(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)))).toBeNull()
  })

  it.each([null, {}])(
    "keeps an invalid allowedChannels policy terminal after reset",
    (allowedChannels) => {
      const parser = new BridgeFrameParser({
        allowedChannels,
        maximumPayloadBytes: { [BRIDGE_CHANNEL_STATE]: 256 },
      } as unknown as BridgeFramePolicy)
      const valid = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1))
      let result: Uint8Array[] | null = []

      expect(() => {
        result = parser.push(valid)
      }).not.toThrow()
      expect(result).toBeNull()
      parser.reset()
      expect(parser.push(valid)).toBeNull()
    },
  )

  it.each([null, []])(
    "rejects an invalid maximumPayloadBytes policy without throwing",
    (maximumPayloadBytes) => {
      const parser = new BridgeFrameParser({
        allowedChannels: [BRIDGE_CHANNEL_STATE],
        maximumPayloadBytes,
      } as unknown as BridgeFramePolicy)

      expect(() => parser.push(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)))).not.toThrow()
      expect(parser.push(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)))).toBeNull()
    },
  )

  it("rejects a runtime non-Uint8Array chunk permanently without throwing", () => {
    const parser = stateParser()
    const valid = frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1))
    let result: Uint8Array[] | null = []

    expect(() => {
      result = parser.push(null as unknown as Uint8Array)
    }).not.toThrow()
    expect(result).toBeNull()
    expect(parser.push(valid)).toBeNull()
  })

  it("rejects a payload cap inherited from the policy prototype", () => {
    const parser = new BridgeFrameParser({
      allowedChannels: [BRIDGE_CHANNEL_STATE],
      maximumPayloadBytes: Object.create({ [BRIDGE_CHANNEL_STATE]: 256 }),
    } as BridgeFramePolicy)

    expect(parser.push(frame(BRIDGE_CHANNEL_STATE, Uint8Array.of(1)))).toBeNull()
  })

  it("applies distinct caps for each allowed channel", () => {
    const parser = new BridgeFrameParser(MULTI_CHANNEL_POLICY)
    const state = frame(BRIDGE_CHANNEL_STATE, new Uint8Array(256))
    const notes = frame(BRIDGE_CHANNEL_NOTES, Uint8Array.of(1, 2, 3))

    expect(parser.push(concat(state, notes))).toEqual([state, notes])
  })
})
