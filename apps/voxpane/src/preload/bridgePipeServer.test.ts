import { execFile } from "node:child_process"
import {
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { lstat, unlink } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createPipeEndpointServer } from "./bridgePipeServer"

const temporaryDirectories: string[] = []
const execFileAsync = promisify(execFile)

interface Deferred {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function waitForSocket(
  socket: ReturnType<typeof createConnection>,
  event: "connect" | "close",
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, resolve)
    socket.once("error", reject)
  })
}

function waitForValue<T>(values: T[], count: number): Promise<void> {
  return waitForCondition(() => values.length >= count, `Timed out waiting for ${count} values`)
}

function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2_000
    const poll = (): void => {
      if (predicate()) {
        resolve()
      } else if (Date.now() >= deadline) {
        reject(new Error(message))
      } else {
        setTimeout(poll, 5)
      }
    }
    poll()
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Windows pipe endpoint", () => {
  it("rejects an overlapping client and accepts a replacement after disconnect", async () => {
    const path = join(temporaryDirectory("voxpane-net-pipe-"), "state.sock")
    const chunks: number[][] = []
    let disconnects = 0
    const failures: Error[] = []
    const server = createPipeEndpointServer({ platform: "win32", path, channel: "state" })

    await server.start(
      (chunk) => chunks.push([...chunk]),
      () => {
        disconnects += 1
      },
      (error) => failures.push(error),
    )

    const first = createConnection(path)
    await waitForSocket(first, "connect")
    const second = createConnection(path)
    const secondClosed = waitForSocket(second, "close")
    await waitForSocket(second, "connect")
    await secondClosed

    first.write(Uint8Array.of(1, 2, 3))
    await waitForValue(chunks, 1)
    expect(chunks).toEqual([[1, 2, 3]])

    const firstClosed = waitForSocket(first, "close")
    first.end()
    await firstClosed
    await waitForCondition(() => disconnects >= 1, "Timed out waiting for disconnect")

    const replacement = createConnection(path)
    await waitForSocket(replacement, "connect")
    replacement.write(Uint8Array.of(4, 5))
    await waitForValue(chunks, 2)

    expect(chunks).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
    expect(failures).toEqual([])

    const replacementClosed = waitForSocket(replacement, "close")
    replacement.end()
    await replacementClosed
    await expect(server.stop()).resolves.toBeUndefined()
    await expect(server.stop()).resolves.toBeUndefined()
  })

  it("reports a listen failure without an uncaught server error", async () => {
    const path = join(temporaryDirectory("voxpane-net-conflict-"), "state.sock")
    const first = createPipeEndpointServer({ platform: "win32", path, channel: "state" })
    const second = createPipeEndpointServer({ platform: "win32", path, channel: "state" })

    await first.start(
      () => {},
      () => {},
      () => {},
    )
    await expect(
      second.start(
        () => {},
        () => {},
        () => {},
      ),
    ).rejects.toBeInstanceOf(Error)

    await second.stop()
    await first.stop()
  })
})

describe.skipIf(process.platform !== "darwin")("macOS FIFO endpoint", () => {
  it("rejects an existing non-FIFO without removing it", async () => {
    const path = join(temporaryDirectory("voxpane-fifo-file-"), "state")
    writeFileSync(path, "owned by someone else")
    const server = createPipeEndpointServer({ platform: "darwin", path, channel: "state" })

    await expect(
      server.start(
        () => {},
        () => {},
        () => {},
      ),
    ).rejects.toThrow(/FIFO/)

    expect(lstatSync(path).isFile()).toBe(true)
    await server.stop()
  })

  it("recreates an existing FIFO and removes only the FIFO it created", async () => {
    const directory = temporaryDirectory("voxpane-fifo-recreate-")
    const path = join(directory, "state")
    await execFileAsync("/usr/bin/mkfifo", [path])
    const previousInode = lstatSync(path).ino
    const server = createPipeEndpointServer(
      { platform: "darwin", path, channel: "state" },
      { sleep: async () => {} },
    )

    await server.start(
      () => {},
      () => {},
      () => {},
    )

    expect(lstatSync(path).isFIFO()).toBe(true)
    expect(lstatSync(path).ino).not.toBe(previousInode)

    await server.stop()
    expect(() => lstatSync(path)).toThrow()
  })

  it("preserves a FIFO that replaces the endpoint path before stop", async () => {
    const directory = temporaryDirectory("voxpane-fifo-replaced-")
    const path = join(directory, "state")
    const replacementPath = join(directory, "replacement")
    const server = createPipeEndpointServer(
      { platform: "darwin", path, channel: "state" },
      { sleep: async () => {} },
    )

    await server.start(
      () => {},
      () => {},
      () => {},
    )
    const ownedInode = lstatSync(path).ino
    await execFileAsync("/usr/bin/mkfifo", [replacementPath])
    const replacementInode = lstatSync(replacementPath).ino
    unlinkSync(path)
    renameSync(replacementPath, path)

    expect(replacementInode).not.toBe(ownedInode)
    await server.stop()

    expect(lstatSync(path).isFIFO()).toBe(true)
    expect(lstatSync(path).ino).toBe(replacementInode)
  })

  it("withdraws the FIFO pathname before closing its writer-facing reader", async () => {
    const directory = temporaryDirectory("voxpane-fifo-withdraw-")
    const path = join(directory, "state")
    const withdrawn = deferred()
    const graceStarted = deferred()
    const releaseGrace = deferred()
    const graceDelays: number[] = []
    const chunks: number[][] = []
    const server = createPipeEndpointServer(
      { platform: "darwin", path, channel: "state" },
      {
        files: {
          lstat,
          unlink: async (target) => {
            await unlink(target)
            withdrawn.resolve()
          },
        },
        sleep: async (delayMs) => {
          graceDelays.push(delayMs)
          graceStarted.resolve()
          await releaseGrace.promise
        },
      },
    )
    await server.start(
      (chunk) => chunks.push([...chunk]),
      () => {},
      () => {},
    )
    const writer = openSync(path, "w")
    writeSync(writer, Uint8Array.of(0))
    await waitForValue(chunks, 1)
    const stopping = server.stop()
    let observationError: unknown = null
    let descriptorError: unknown = null
    let lateFileIsRegular = false

    try {
      await settleWithin(withdrawn.promise, 1_000)
      await settleWithin(graceStarted.promise, 1_000)
      try {
        writeSync(writer, Uint8Array.of(1))
      } catch (error) {
        descriptorError = error
      }
      const lateFile = openSync(path, "w")
      closeSync(lateFile)
      lateFileIsRegular = lstatSync(path).isFile()
    } catch (error) {
      observationError = error
    } finally {
      releaseGrace.resolve()
      try {
        await stopping
      } finally {
        closeSync(writer)
      }
    }

    expect(observationError).toBeNull()
    expect(descriptorError).toBeNull()
    expect(graceDelays).toHaveLength(1)
    expect(graceDelays[0]).toBeGreaterThanOrEqual(300)
    expect(lateFileIsRegular).toBe(true)
    expect(lstatSync(path).isFile()).toBe(true)
  })

  it("unblocks a large O_WRONLY writer with EPIPE when the app reader closes", async () => {
    const directory = temporaryDirectory("voxpane-fifo-epipe-")
    const path = join(directory, "notes")
    const chunks: number[][] = []
    const server = createPipeEndpointServer({ platform: "darwin", path, channel: "notes" })
    await server.start(
      (chunk) => chunks.push([...chunk.subarray(0, 1)]),
      () => {},
      () => {},
    )

    const writer = execFileAsync(
      process.execPath,
      [
        "-e",
        `const fs = require("node:fs");
const fd = fs.openSync(process.argv[1], fs.constants.O_WRONLY);
process.stdout.write("opened\\n");
const block = Buffer.alloc(4 * 1024 * 1024, 1);
try {
  while (true) fs.writeSync(fd, block);
} catch (error) {
  process.stdout.write(error.code ?? String(error));
  if (error.code !== "EPIPE") process.exitCode = 2;
} finally {
  fs.closeSync(fd);
}`,
        path,
      ],
      { timeout: 3_000 },
    )

    await waitForValue(chunks, 1)
    const stopping = server.stop()
    const result = await settleWithin(writer, 2_000)
    await stopping

    expect(result.stdout).toBe("opened\nEPIPE")
    expect(result.stderr).toBe("")
  })

  it("bounds reader shutdown when the owned pathname disappears after data", async () => {
    const directory = temporaryDirectory("voxpane-fifo-missing-stop-")
    const path = join(directory, "state")
    const chunks: number[][] = []
    const server = createPipeEndpointServer({ platform: "darwin", path, channel: "state" })
    await server.start(
      (chunk) => chunks.push([...chunk]),
      () => {},
      () => {},
    )
    const writer = openSync(path, "r+")
    writeSync(writer, Uint8Array.of(7))
    await waitForValue(chunks, 1)
    unlinkSync(path)
    const stopping = server.stop()
    let stopError: unknown = null

    try {
      await settleWithin(stopping, 800)
    } catch (error) {
      stopError = error
    } finally {
      closeSync(writer)
      await settleWithin(stopping, 1_000)
    }

    expect(stopError).toBeNull()
  })
})
