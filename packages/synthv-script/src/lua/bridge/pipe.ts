import type { ResolvedRendezvous } from "./rendezvous"
import { readRendezvous } from "./rendezvous"

const RETRY_INTERVAL_MS = 240

export type PipeChannel = "state" | "scroll" | "notes"

export interface PipeConnection {
  session: string
  serial: number
}

export interface PipeClient {
  connect(elapsedMs: number): PipeConnection | undefined
  validate(elapsedMs: number, serial: number): boolean
  write(channel: PipeChannel, frame: string): boolean
  invalidate(message: string): void
  disconnect(): void
  describe(): string
}

interface PipeHandles {
  state: LuaFile
  scroll: LuaFile
  notes: LuaFile
}

interface OpenedEndpoint {
  handle: LuaFile
}

interface OpenFailed {
  error: string
}

function errorText(error: unknown): string {
  return tostring(error)
}

function closeHandle(handle: LuaFile): void {
  try {
    handle.close()
  } catch (_error) {}
}

function openEndpoint(channel: PipeChannel, path: string): OpenedEndpoint | OpenFailed {
  try {
    const [openedHandle, reason] = io.open(path, "wb")
    if (openedHandle === undefined) {
      return { error: `open ${channel} failed: ${reason ?? "unavailable"}` }
    }
    const handle = openedHandle as SVLuaFile
    try {
      const [unbuffered, bufferReason] = handle.setvbuf("no")
      if (unbuffered === undefined) {
        closeHandle(handle)
        return {
          error: `open ${channel} failed: ${bufferReason ?? "setvbuf returned nil"}`,
        }
      }
    } catch (error) {
      closeHandle(handle)
      return { error: `open ${channel} failed: ${errorText(error)}` }
    }
    return { handle }
  } catch (error) {
    return { error: `open ${channel} failed: ${errorText(error)}` }
  }
}

function openAll(paths: {
  state: string
  scroll: string
  notes: string
}): PipeHandles | OpenFailed {
  const state = openEndpoint("state", paths.state)
  if ("error" in state) {
    return state
  }

  const scroll = openEndpoint("scroll", paths.scroll)
  if ("error" in scroll) {
    closeHandle(state.handle)
    return scroll
  }

  const notes = openEndpoint("notes", paths.notes)
  if ("error" in notes) {
    closeHandle(state.handle)
    closeHandle(scroll.handle)
    return notes
  }

  return { state: state.handle, scroll: scroll.handle, notes: notes.handle }
}

export function createPipeClient(directory: string): PipeClient {
  let handles: PipeHandles | undefined
  let connection: PipeConnection | undefined
  let connectedAdvertisement: ResolvedRendezvous | undefined
  let candidate: ResolvedRendezvous | undefined
  let quarantined: ResolvedRendezvous | undefined
  let serial = 0
  let lastSession = "none"
  let nextAttemptMs = 0
  let lastElapsedMs = 0
  let lastError = "none"

  function closeAll(): void {
    const current = handles
    handles = undefined
    connection = undefined
    connectedAdvertisement = undefined
    if (current === undefined) {
      return
    }
    closeHandle(current.state)
    closeHandle(current.scroll)
    closeHandle(current.notes)
  }

  function failWrite(message: string): false {
    lastError = message
    quarantined = connectedAdvertisement
    closeAll()
    nextAttemptMs = lastElapsedMs + RETRY_INTERVAL_MS
    return false
  }

  function canOpen(advertised: ResolvedRendezvous): boolean {
    if (quarantined !== undefined) {
      if (advertised.session === quarantined.session) {
        if (advertised.heartbeatSeconds <= quarantined.heartbeatSeconds) {
          return false
        }
        quarantined = undefined
        candidate = undefined
        return true
      }
      quarantined = undefined
    }

    if (candidate === undefined || candidate.session !== advertised.session) {
      candidate = advertised
      return false
    }
    if (advertised.heartbeatSeconds <= candidate.heartbeatSeconds) {
      return false
    }
    candidate = undefined
    return true
  }

  function connect(elapsedMs: number): PipeConnection | undefined {
    lastElapsedMs = elapsedMs
    if (elapsedMs < nextAttemptMs) {
      return connection
    }
    nextAttemptMs = elapsedMs + RETRY_INTERVAL_MS

    let advertised: ResolvedRendezvous | undefined
    try {
      advertised = readRendezvous(directory)
    } catch (error) {
      lastError = `rendezvous failed: ${errorText(error)}`
      closeAll()
      return undefined
    }

    if (connection !== undefined && advertised?.session === connection.session) {
      if (
        connectedAdvertisement === undefined ||
        advertised.heartbeatSeconds > connectedAdvertisement.heartbeatSeconds
      ) {
        connectedAdvertisement = advertised
      }
      return connection
    }

    if (connection !== undefined) {
      closeAll()
    }
    if (advertised === undefined) {
      lastError = "rendezvous unavailable"
      return undefined
    }

    lastSession = advertised.session
    if (!canOpen(advertised)) {
      return undefined
    }
    const opened = openAll(advertised)
    if ("error" in opened) {
      lastError = opened.error
      quarantined = advertised
      return undefined
    }

    handles = opened
    serial = serial + 1
    connection = { session: advertised.session, serial }
    connectedAdvertisement = advertised
    return connection
  }

  return {
    connect,

    validate(elapsedMs, expectedSerial) {
      return connect(elapsedMs)?.serial === expectedSerial
    },

    write(channel, frame) {
      const current = handles
      if (current === undefined) {
        return false
      }
      try {
        const [_written, reason] = current[channel].write(frame)
        if (_written === undefined) {
          return failWrite(`write ${channel} failed: ${reason ?? "returned nil"}`)
        }
        return true
      } catch (error) {
        return failWrite(`write ${channel} failed: ${errorText(error)}`)
      }
    },

    invalidate(message) {
      lastError = message
      if (connectedAdvertisement !== undefined) {
        quarantined = connectedAdvertisement
      }
      closeAll()
      nextAttemptMs = lastElapsedMs + RETRY_INTERVAL_MS
    },

    disconnect() {
      closeAll()
      candidate = undefined
      quarantined = undefined
      nextAttemptMs = 0
    },

    describe() {
      const status =
        connection === undefined
          ? `disconnected (app ${lastSession})`
          : `connected (app ${connection.session})`
      return `${status}, last error: ${lastError}`
    },
  }
}
