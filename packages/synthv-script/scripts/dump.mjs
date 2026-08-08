import { lstatSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const RENDEZVOUS_BYTES = 128
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const FRESH_SECONDS = 2
const CHANNELS = ["state", "scroll", "notes"]
const RECORD = /^VPR1\n([0-9]+)\n([0-9a-f]{32})\n([0-9a-f]{8})\n *$/

function defaultDirectory() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(local, "voxpane", "bridge")
  }
  return join(homedir(), "Library", "Application Support", "voxpane", "bridge")
}

function checksum(bytes) {
  let hash = FNV_OFFSET
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function decodePipeSession(bytes) {
  if (bytes.length !== RENDEZVOUS_BYTES) {
    return null
  }

  const text = new TextDecoder().decode(bytes)
  const match = RECORD.exec(text)
  if (match === null) {
    return null
  }

  const [, heartbeatText, session, expectedChecksum] = match
  const heartbeatSeconds = Number(heartbeatText)
  if (!Number.isSafeInteger(heartbeatSeconds)) {
    return null
  }

  const prefix = `VPR1\n${heartbeatText}\n${session}\n`
  if (checksum(new TextEncoder().encode(prefix)) !== expectedChecksum) {
    return null
  }

  return { heartbeatSeconds, session }
}

export function pipeEndpoint(platform, directory, session, channel) {
  if (platform === "win32") {
    return `\\\\.\\pipe\\voxpane-${session}-${channel}`
  }
  return posix.join(directory, `pipe-${session}-${channel}`)
}

function endpointKind(path, lstat) {
  try {
    const stat = lstat(path)
    if (stat.isSymbolicLink()) {
      return "symlink"
    }
    return stat.isFIFO() ? "fifo" : "non-fifo"
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "missing"
    }
    return `error: ${error?.code ?? error?.message ?? String(error)}`
  }
}

function endpoints(platform, directory, session, lstat) {
  return CHANNELS.map((channel) => {
    const path = pipeEndpoint(platform, directory, session, channel)
    return {
      channel,
      path,
      kind: platform === "win32" ? "named-pipe" : endpointKind(path, lstat),
    }
  })
}

export function inspectPipeSession({
  directory,
  platform = process.platform,
  nowSeconds = Math.floor(Date.now() / 1_000),
  readFile = readFileSync,
  lstat = lstatSync,
}) {
  const rendezvousPath = join(directory, "pipe-session")
  let rendezvousStat
  try {
    rendezvousStat = lstat(rendezvousPath)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "unavailable" }
    }
    return {
      status: "malformed",
      reason: `could not inspect pipe-session: ${error?.message ?? error}`,
    }
  }

  if (rendezvousStat.isSymbolicLink()) {
    return { status: "malformed", reason: "pipe-session is a symlink" }
  }
  if (!rendezvousStat.isFile()) {
    return { status: "malformed", reason: "pipe-session is not a regular file" }
  }

  let bytes
  try {
    bytes = readFile(rendezvousPath)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "unavailable" }
    }
    return {
      status: "malformed",
      reason: `could not read pipe-session: ${error?.message ?? error}`,
    }
  }

  const record = decodePipeSession(bytes)
  if (record === null) {
    return { status: "malformed", reason: "invalid VPR1 record" }
  }

  const ageSeconds = nowSeconds - record.heartbeatSeconds
  if (ageSeconds < 0) {
    return { status: "malformed", reason: "future heartbeat" }
  }

  return {
    status: ageSeconds > FRESH_SECONDS ? "stale" : "fresh",
    ...record,
    ageSeconds,
    endpoints: endpoints(platform, directory, record.session, lstat),
  }
}

export function formatPipeSession(result) {
  if (result.status === "unavailable") {
    return "pipe-session: unavailable"
  }
  if (result.status === "malformed") {
    return `pipe-session: malformed (${result.reason})`
  }

  return [
    `pipe-session: ${result.status}`,
    `session: ${result.session}`,
    `heartbeat: ${result.heartbeatSeconds} (age: ${result.ageSeconds}s)`,
    ...result.endpoints.map(
      (endpoint) => `${endpoint.channel}: ${endpoint.path} (${endpoint.kind})`,
    ),
  ].join("\n")
}

export function directoryFromArguments(argv = process.argv) {
  const argumentsAfterDoubleDash = argv.slice(2)
  const directoryArguments =
    argumentsAfterDoubleDash[0] === "--"
      ? argumentsAfterDoubleDash.slice(1)
      : argumentsAfterDoubleDash
  return directoryArguments[0] ?? defaultDirectory()
}

export function main(argv = process.argv) {
  const result = inspectPipeSession({ directory: directoryFromArguments(argv) })
  console.log(formatPipeSession(result))
  if (result.status === "malformed") {
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
