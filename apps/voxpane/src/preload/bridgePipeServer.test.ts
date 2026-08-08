import { execFile } from "node:child_process"
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { createPipeEndpointServer } from "./bridgePipeServer"

const temporaryDirectories: string[] = []
const execFileAsync = promisify(execFile)

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
    const server = createPipeEndpointServer({ platform: "darwin", path, channel: "state" })

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
})
