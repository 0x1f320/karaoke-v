import { type ChildProcess, spawn } from "node:child_process"
import { unlink } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { dirname, join, sep } from "node:path"

const GUARDIAN_EXECUTABLE = "voxpane-bridge-guardian"
const STARTUP_TIMEOUT_MS = 2_000
const MAX_STARTUP_OUTPUT_BYTES = 4 * 1024
let nextControlId = 0

export interface BridgeGuardian {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface BridgeGuardianOptions {
  rendezvousPath: string
  session: string
  endpointPaths: readonly [string, string, string]
  onFatal(error: Error): void
}

export interface BridgeGuardianDependencies {
  executable?: string
  argumentsPrefix?: string[]
  startupTimeoutMs?: number
}

export function resolveBridgeGuardianExecutable(
  packageEntry = require.resolve("@voxpane/macos-helper"),
): string {
  const executable = join(dirname(packageEntry), GUARDIAN_EXECUTABLE)
  const packagedSegment = `${sep}Contents${sep}Resources${sep}app.asar${sep}`
  const packagedAt = executable.indexOf(packagedSegment)
  return packagedAt < 0
    ? executable
    : join(executable.slice(0, packagedAt), "Contents", "Helpers", GUARDIAN_EXECUTABLE)
}

export function createBridgeGuardian(
  options: BridgeGuardianOptions,
  dependencies: BridgeGuardianDependencies = {},
): BridgeGuardian {
  return new ChildBridgeGuardian(options, dependencies)
}

class ChildBridgeGuardian implements BridgeGuardian {
  private child: ChildProcess | null = null
  private controlServer: Server | null = null
  private controlSocket: Socket | null = null
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private ready = false
  private expectedExit = false
  private fatalReported = false
  private readonly controlPath: string

  constructor(
    private readonly options: BridgeGuardianOptions,
    private readonly dependencies: BridgeGuardianDependencies,
  ) {
    this.controlPath = join(
      "/tmp",
      `vpg-${process.pid}-${options.session.slice(0, 8)}-${nextControlId++}.sock`,
    )
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.startInternal()
    }
    return this.startPromise
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.expectedExit = true
      this.withdrawControlListener()
      const socket = this.controlSocket
      this.stopPromise =
        socket && !socket.destroyed
          ? new Promise((resolve) => {
              socket.end(resolve)
              socket.unref()
            })
          : Promise.resolve()
      if (!this.ready) {
        this.child?.kill()
      }
    }
    return this.stopPromise
  }

  private startInternal(): Promise<void> {
    const executable = this.dependencies.executable ?? resolveBridgeGuardianExecutable()
    const args = [
      ...(this.dependencies.argumentsPrefix ?? []),
      this.controlPath,
      this.options.rendezvousPath,
      this.options.session,
      ...this.options.endpointPaths,
    ]

    return new Promise((resolve, reject) => {
      let settled = false
      let stderr = ""
      let readiness = ""
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        const child = this.child
        child?.stderr?.off("data", onStderr)
        child?.off("error", onChildError)
        if (error) {
          this.expectedExit = true
          this.withdrawControlListener()
          this.controlSocket?.destroy()
          child?.kill()
          reject(error)
          return
        }
        this.ready = true
        this.withdrawControlListener()
        child?.stderr?.destroy()
        child?.unref()
        this.controlSocket?.unref()
        resolve()
      }
      const reportFatal = (error: Error): void => {
        if (this.expectedExit || this.fatalReported) return
        this.fatalReported = true
        this.options.onFatal(error)
      }
      const onControlData = (chunk: Buffer): void => {
        readiness = (readiness + chunk.toString("utf8")).slice(0, MAX_STARTUP_OUTPUT_BYTES)
        const newline = readiness.indexOf("\n")
        if (newline < 0) {
          if (readiness.length >= MAX_STARTUP_OUTPUT_BYTES) {
            finish(new Error("Bridge guardian readiness record is too large"))
          }
          return
        }
        const record = readiness.slice(0, newline)
        if (record !== "READY") {
          finish(new Error(`Invalid bridge guardian readiness record: ${record}`))
          return
        }
        finish()
      }
      const onStderr = (chunk: Buffer): void => {
        stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STARTUP_OUTPUT_BYTES)
      }
      const onChildError = (error: Error): void => finish(error)
      const server = createServer((socket) => {
        if (this.controlSocket) {
          socket.destroy()
          return
        }
        this.controlSocket = socket
        socket.on("data", onControlData)
        socket.on("error", (error) => {
          if (!settled) finish(error)
          else reportFatal(error)
        })
        socket.once("close", () => {
          const error = new Error("Bridge guardian control socket closed unexpectedly")
          if (!settled) finish(error)
          else if (this.ready) reportFatal(error)
        })
      })
      this.controlServer = server
      server.once("error", (error) => finish(error))
      server.listen(this.controlPath, () => {
        if (this.expectedExit) {
          finish(new Error("Bridge guardian stopped before readiness"))
          return
        }
        const child = spawn(executable, args, {
          detached: true,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        })
        this.child = child
        child.stderr?.on("data", onStderr)
        child.once("error", onChildError)
        child.once("exit", (code, signal) => {
          if (code === 0 && !signal) return
          const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          const detail = stderr.trim()
          const error = new Error(
            `Bridge guardian launcher exited with ${reason}${detail ? `: ${detail}` : ""}`,
          )
          if (!settled) finish(error)
          else if (this.ready) reportFatal(error)
        })
        timer = setTimeout(
          () => finish(new Error("Bridge guardian control readiness timed out")),
          this.dependencies.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
        )
      })
    })
  }

  private withdrawControlListener(): void {
    const server = this.controlServer
    this.controlServer = null
    if (server) {
      try {
        server.close()
      } catch {}
    }
    void unlink(this.controlPath).catch(() => {})
  }
}
