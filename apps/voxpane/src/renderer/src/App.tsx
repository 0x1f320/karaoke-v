import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  type AudioMeterSnapshot,
  type AudioMeterState,
  EMPTY_AUDIO_METER_SNAPSHOT,
} from "../../shared/audioMeter"
import type { BridgeNote } from "../../shared/bridgeChannels"
import type { BridgeTransportDiagnostics } from "../../shared/bridgeDiagnostics"
import type { PianoRoll, Rect, Viewport } from "../../shared/geometry"
import {
  DEFAULT_PREFERENCES,
  type GlowPreferences,
  type ParticlePreferences,
  type PitchPreferences,
  type TrailPreferences,
} from "../../shared/preferences"
import { Permissions } from "./components/Permissions"
import { Settings } from "./components/Settings"
import { Toolbar } from "./components/Toolbar"
import { CanvasManager } from "./playback/canvasManager"
import {
  BridgeDiagnosticsGraphHistory,
  BridgeDiagnosticsStats,
  BridgeScrollLatency,
  diagnosticsGraphSample,
  diagnosticsPanelPosition,
  drawDiagnosticsGraph,
  formatBridgeDiagnostics,
} from "./playback/channelDiagnostics"
import { predictedNoteRect, toReadFrame } from "./playback/debugNotes"
import { composeFrame, frameTransform, padRect, pitchBounds } from "./playback/frame"
import { ScrollLatencyProbe } from "./playback/latencyProbe"
import {
  anchoredRect,
  anchorFromMatch,
  followRect,
  locateNote,
  type ReadAnchor,
  rebaseAnchor,
} from "./playback/locate"
import { intensityScale, overhangSeconds, pitchExtent, samplePitch } from "./playback/pitch"
import { Transport } from "./playback/transport"
import { NoteRenderer } from "./render/noteRenderer"
import {
  BORDER_PX,
  FILL,
  glowParams,
  PLAYING_FILL,
  particleParams,
  REACH_FILL,
  REACH_PAD_PX,
  REACH_STROKE,
  STROKE,
  trailParams,
} from "./render/palette"

/** Shared empty list, so a frame with no bands allocates nothing. */
const EMPTY_REACHES: Rect[] = []
/**
 * How far the roll may move in one frame and a note still be matched to a rect,
 * px. Around 1400px/s at 60Hz — a fling, not a drag. The mapping the match is
 * predicted from is tens of milliseconds old, so past this the prediction is
 * already further out than the gap between two notes. It only gates taking a
 * NEW match; a note that has one keeps it however hard the roll is moving.
 */
const MAX_MATCH_SLIP_PX = 24
const CANVAS_READ_GAP_MS = 250
const DIAGNOSTICS_PANEL_PAD_PX = 8
const DIAGNOSTICS_GRAPH_W = 260
const DIAGNOSTICS_GRAPH_H = 132
const DIAGNOSTICS_GRAPH_SAMPLES = 180
const AUDIO_METER_POLL_MS = 125

function audioMeterCanPoll(state: AudioMeterState): boolean {
  return state === "starting" || state === "running" || state === "silent"
}

/**
 * The note whose contour covers `seconds` — the one sounding, or, in the gap
 * between two, whichever of them still reaches this far.
 *
 * A note's contour does not begin at its onset or end at its end: the glide in
 * and the release out are the parts that travel furthest from it. Stopping the
 * effect at the note's own edges left those undrawn, and left the band claiming
 * a reach the effect never went to.
 */
function noteInContour(transport: Transport, seconds: number): BridgeNote | null {
  const sounding = transport.noteAt(seconds)
  if (sounding) {
    return sounding
  }
  const { before, after } = transport.neighbours(seconds)
  if (before && seconds - before.offS <= overhangSeconds(before).tail) {
    return before
  }
  if (after && after.onS - seconds <= overhangSeconds(after).lead) {
    return after
  }
  return null
}

function latencyProbeEnabled(debug: boolean): boolean {
  try {
    return debug || window.localStorage.getItem("voxpaneLatencyProbe") === "1"
  } catch {
    return debug
  }
}

function viewportClip(vp: Viewport): Rect {
  const origin = vp.origin ?? { x: window.screenX, y: window.screenY }
  return {
    x: vp.canvas.x - origin.x,
    y: vp.canvas.y - origin.y,
    w: vp.canvas.w,
    h: vp.canvas.h,
  }
}

// One renderer bundle serves every window; each is loaded with the hash naming
// its view, the overlay with no hash.
export function App() {
  switch (window.location.hash) {
    case "#toolbar":
      return <Toolbar />
    case "#settings":
      return <Settings />
    case "#permissions":
      return <Permissions />
    default:
      return <Overlay />
  }
}

function Overlay() {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const diagnosticsRef = useRef<HTMLPreElement>(null)
  const diagnosticsGraphRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const diagnosticsElement = diagnosticsRef.current
    const diagnosticsGraphElement = diagnosticsGraphRef.current
    const renderer = new NoteRenderer(host)
    const diagnosticsLabels = {
      connection: (values: {
        status: string
        session: string
        recoveries: number
        malformedFrames: number
        endpointFailures: number
        disconnects: number
      }) => t("debug.channels.connection", values),
      status: (status: BridgeTransportDiagnostics["status"] | null) =>
        status === null
          ? t("debug.channels.status.unavailable")
          : t(`debug.channels.status.${status}`),
      state: t("debug.channels.state"),
      scroll: t("debug.channels.scroll"),
      notes: t("debug.channels.notes"),
      received: t("debug.channels.received"),
      size: t("debug.channels.size"),
      applied: t("debug.channels.applied"),
      average: t("debug.channels.average"),
      current: t("debug.channels.current"),
      min: t("debug.channels.min"),
      seq: t("debug.channels.seq"),
      notesSeq: t("debug.channels.notesSeq"),
      scrollSeq: t("debug.channels.scrollSeq"),
      rev: t("debug.channels.rev"),
      failures: t("debug.channels.failures"),
      stateInvalid: t("debug.channels.stateInvalid"),
      scrollInvalid: t("debug.channels.scrollInvalid"),
      scrollSeqMismatch: t("debug.channels.scrollSeqMismatch"),
      notesInvalid: t("debug.channels.notesInvalid"),
      notesSeqMismatch: t("debug.channels.notesSeqMismatch"),
      revMismatch: t("debug.channels.revMismatch"),
      stateApplied: t("debug.channels.stateApplied"),
      notesApplied: t("debug.channels.notesApplied"),
      scrollApplied: t("debug.channels.scrollApplied"),
      max: t("debug.channels.max"),
      p95: t("debug.channels.p95"),
      p99: t("debug.channels.p99"),
      missing: t("debug.channels.missing"),
    }
    const diagnosticsStats = new BridgeDiagnosticsStats()
    const diagnosticsGraph = new BridgeDiagnosticsGraphHistory(DIAGNOSTICS_GRAPH_SAMPLES)
    const scrollLatency = new BridgeScrollLatency()
    const audioMeterLabels = {
      title: t("debug.audioMeter.title"),
      peak: t("debug.audioMeter.peak"),
      silent: t("debug.audioMeter.silent"),
      starting: t("debug.audioMeter.starting"),
      idle: t("debug.audioMeter.idle"),
      unsupported: t("debug.audioMeter.unsupported"),
      error: t("debug.audioMeter.error"),
    }

    let read: PianoRoll | null = null
    let audioMeterSnapshot: AudioMeterSnapshot = {
      ...EMPTY_AUDIO_METER_SNAPSHOT,
    }
    let audioMeterEnabled = DEFAULT_PREFERENCES.audioMeter
    let audioMeterStarting = false
    let audioMeterPolling = false
    const setAudioMeterError = (error: unknown) => {
      audioMeterStarting = false
      audioMeterPolling = false
      audioMeterSnapshot = {
        ...EMPTY_AUDIO_METER_SNAPSHOT,
        state: "error",
        updatedAtMs: window.bridge.monotonicNow(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const startAudioMeter = () => {
      if (!audioMeterEnabled || audioMeterStarting || audioMeterCanPoll(audioMeterSnapshot.state)) {
        return
      }
      audioMeterStarting = true
      audioMeterPolling = false
      audioMeterSnapshot = {
        ...EMPTY_AUDIO_METER_SNAPSHOT,
        state: "starting",
        updatedAtMs: window.bridge.monotonicNow(),
      }
      void window.audioMeter
        .start()
        .then((snapshot) => {
          audioMeterStarting = false
          audioMeterSnapshot = snapshot
          audioMeterPolling = audioMeterCanPoll(snapshot.state)
        })
        .catch(setAudioMeterError)
    }
    const stopAudioMeter = () => {
      audioMeterEnabled = false
      audioMeterStarting = false
      audioMeterPolling = false
      audioMeterSnapshot = { ...EMPTY_AUDIO_METER_SNAPSHOT }
      void window.audioMeter.stop().catch((error) => {
        audioMeterSnapshot = {
          ...EMPTY_AUDIO_METER_SNAPSHOT,
          state: "error",
          updatedAtMs: window.bridge.monotonicNow(),
          error: error instanceof Error ? error.message : String(error),
        }
      })
    }
    const audioMeterTimer = window.setInterval(() => {
      if (!audioMeterEnabled || !audioMeterPolling) {
        return
      }
      void window.audioMeter
        .read()
        .then((snapshot) => {
          audioMeterSnapshot = snapshot
          audioMeterPolling = audioMeterCanPoll(snapshot.state)
        })
        .catch(setAudioMeterError)
    }, AUDIO_METER_POLL_MS)
    if (audioMeterEnabled) {
      startAudioMeter()
    }

    // Bounding boxes are a debug visualization. Default off, and off until the
    // stored value arrives, so nothing flashes on startup.
    let debug = false
    let particles = particleParams(DEFAULT_PREFERENCES.particles)
    let glow = glowParams(DEFAULT_PREFERENCES.glow)
    let trail = trailParams(DEFAULT_PREFERENCES.trail)
    let pitch = DEFAULT_PREFERENCES.pitch
    const adopt = (p: {
      debug: boolean
      effects: boolean
      audioMeter: boolean
      particles: ParticlePreferences
      glow: GlowPreferences
      trail: TrailPreferences
      pitch: PitchPreferences
    }) => {
      debug = p.debug
      window.bridge.setDiagnosticsEnabled(debug)
      if (!debug && diagnosticsElement) {
        diagnosticsElement.classList.add("hidden")
        diagnosticsStats.reset()
        diagnosticsGraph.reset()
        scrollLatency.reset()
      }
      if (!debug && diagnosticsGraphElement) {
        diagnosticsGraphElement.classList.add("hidden")
      }
      audioMeterEnabled = p.audioMeter
      if (audioMeterEnabled) {
        startAudioMeter()
      } else if (audioMeterSnapshot.state !== "idle" || audioMeterStarting || audioMeterPolling) {
        stopAudioMeter()
      }
      particles = { ...particleParams(p.particles), enabled: p.effects && p.particles.enabled }
      glow = { ...glowParams(p.glow), enabled: p.effects && p.glow.enabled }
      trail = { ...trailParams(p.trail), enabled: p.effects && p.trail.enabled }
      pitch = p.pitch
    }
    window.preferences.get().then(adopt)
    const unsubscribe = window.preferences.onChange(adopt)

    const transport = new Transport()
    const latencyProbe = new ScrollLatencyProbe({ log: (line) => window.debug.latency(line) })
    latencyProbe.setEnabled(false)
    const canvasManager = new CanvasManager(() => window.overlay.getCanvasAsync(), {
      intervalMs: CANVAS_READ_GAP_MS,
      now: () => window.bridge.monotonicNow(),
      onRead: (event) => latencyProbe.recordCanvasRead(event),
    })
    canvasManager.start()

    let raf = 0
    let uploaded: PianoRoll | null = null
    // The read whose coordinate frame the live particles are currently in.
    let based: PianoRoll | null = null
    // The rect the sounding note was matched to, and the read it came out of.
    // Held for as long as that note sounds — see the match below.
    let match: { onset: number; read: PianoRoll; rect: Rect } | null = null
    // What one matched rect said about where every note in that read sits, and
    // the read it says it about. Kept across reads, so a note that starts while
    // the roll is moving — when no match may be taken — is still placed exactly.
    let anchored: { anchor: ReadAnchor; read: PianoRoll } | null = null
    // Onset of the note last seen sounding, so a change can strike the glow.
    // Tracked from the schedule, not the rect: a note still starts even on a
    // frame where it could not be matched to one.
    let soundingOnset: number | null = null
    // Where the roll sat on the previous frame, so this one can tell how fast it
    // is moving. Null whenever the last frame had nothing to compare against.
    let wasAt: { contentX: number; refY: number } | null = null
    let frameId = 0
    const updateDiagnostics = (nowMs: number, clip: Rect | null, viewport: Viewport | null) => {
      if (!diagnosticsElement || !debug) {
        return
      }
      if (!clip || clip.w <= 0 || clip.h <= 0) {
        diagnosticsElement.classList.add("hidden")
        diagnosticsGraphElement?.classList.add("hidden")
        return
      }
      const diagnostics = window.bridge.readDiagnostics()
      const scrollAppliedMs = scrollLatency.sample(viewport, diagnostics, nowMs)
      diagnosticsGraph.push(diagnosticsGraphSample(diagnostics, nowMs, scrollAppliedMs))
      diagnosticsElement.textContent = formatBridgeDiagnostics(diagnostics, {
        nowEpochMs: Date.now(),
        nowMonotonicMs: nowMs,
        scrollAppliedMs,
        stats: diagnosticsStats.sample(diagnostics, nowMs, scrollAppliedMs),
        labels: diagnosticsLabels,
      }).join("\n")
      diagnosticsElement.classList.remove("hidden")
      const position = diagnosticsPanelPosition(
        clip,
        {
          w: diagnosticsElement.offsetWidth,
          h: diagnosticsElement.offsetHeight,
        },
        DIAGNOSTICS_PANEL_PAD_PX,
      )
      diagnosticsElement.style.transform = `translate(${position.x}px, ${position.y}px)`
      if (diagnosticsGraphElement) {
        drawDiagnosticsGraph(diagnosticsGraphElement, {
          clip,
          dpr: window.devicePixelRatio || 1,
          history: diagnosticsGraph.samples(),
          labels: diagnosticsLabels,
          max: diagnosticsGraph.scale(),
          padding: DIAGNOSTICS_PANEL_PAD_PX,
          width: DIAGNOSTICS_GRAPH_W,
          height: DIAGNOSTICS_GRAPH_H,
        })
        diagnosticsGraphElement.classList.remove("hidden")
      }
    }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      frameId += 1
      const nowMs = window.bridge.monotonicNow()
      latencyProbe.setEnabled(latencyProbeEnabled(debug))
      const nativeCanvas = canvasManager.current()
      transport.poll(nowMs, nativeCanvas)
      const currentRead = transport.pianoRoll
      if (currentRead) {
        read = currentRead
      }
      const latestViewport = transport.viewport
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight

      const audioMeter =
        audioMeterSnapshot.state === "idle"
          ? null
          : { snapshot: audioMeterSnapshot, labels: audioMeterLabels }
      const vp =
        debug || transport.playing || renderer.effectsActive || audioMeter ? latestViewport : null

      if (!vp || !read || vp.refY === undefined) {
        updateDiagnostics(nowMs, null, null)
        wasAt = null
        if (uploaded) {
          renderer.clear()
          uploaded = null
        }
        renderer.draw({
          width: w,
          height: h,
          dpr,
          offsetX: 0,
          offsetY: 0,
          scaleX: 1,
          clip: vp ? viewportClip(vp) : { x: 0, y: 0, w: 0, h: 0 },
          fill: FILL,
          stroke: STROKE,
          border: BORDER_PX,
          reaches: EMPTY_REACHES,
          reachFill: REACH_FILL,
          reachStroke: REACH_STROKE,
          playing: null,
          playingFill: PLAYING_FILL,
          emit: null,
          trailEmit: null,
          particles,
          noteStarted: false,
          glow,
          trail,
          audioMeter:
            audioMeter && vp ? { snapshot: audioMeter.snapshot, labels: audioMeter.labels } : null,
        })
        latencyProbe.sample({
          atMs: nowMs,
          frame: frameId,
          native: nativeCanvas,
          applied: latestViewport,
          drawStartedAtMs: nowMs,
          drawEndedAtMs: window.bridge.monotonicNow(),
        })
        return
      }

      if (based && based !== read) {
        renderer.rebaseEffects(based, read)
      }
      based = read

      const transform = frameTransform(read, vp, vp.refY)

      // Which note is sounding, and which computed rect is it? The bridge
      // answers the first exactly; matching/following keeps the second stable.
      let hit: Rect | null = null
      let progress = 0
      let onset: number | null = null
      // Which note the glow is struck for. Not the same as `onset`: that names
      // the note being placed, which off the ends of a contour is one the
      // effects are not sounding yet.
      let struck: number | null = null
      // How far the voice is from the note, and what that does to the effect.
      // Neutral unless the user asked for it, so the emit point stays on the
      // note's centre and the effect keeps the strength they dialled in.
      let offsetSemitones = 0
      // The trail draws the sung curve whether or not the effects follow it.
      let trailSemitones = 0
      let boost = 1
      // A band per visible note showing where its effect can travel: how near a
      // reach comes to the edge of the piano roll, past which the effects layer
      // is masked away. That is a question about the drawing and not part of the
      // look, so it is a debug visualization like the note boxes.
      let reaches: Rect[] = EMPTY_REACHES
      // How far the roll moved since the previous frame. Taking a match means
      // predicting a note's position from the bridge's view mapping, which is a
      // round trip old. During a fling it may not START one; it does not have
      // to. A match already taken is followed from read to read, and the anchor
      // it left behind places every note that has none. Neither asks the
      // mapping where anything is, so both survive any scrolling.
      const moved = wasAt
        ? Math.abs(vp.contentX - wasAt.contentX) + Math.abs(vp.refY - wasAt.refY)
        : 0
      wasAt = { contentX: vp.contentX, refY: vp.refY }
      const settled = moved <= MAX_MATCH_SLIP_PX

      if (match && match.read !== read) {
        const followed = followRect(match.rect, match.read, read, read.notes)
        match = followed ? { onset: match.onset, read, rect: followed } : null
      }
      if (anchored && anchored.read !== read) {
        anchored = { anchor: rebaseAnchor(anchored.anchor, anchored.read, read), read }
      }

      const view = transport.view
      if (debug && view) {
        const notes = transport
          .notesBetween(view.mapping.viewLeft, view.mapping.viewRight)
          .map((note) => toReadFrame(predictedNoteRect(note, view, vp), transform))
        renderer.setNotes(notes)
        uploaded = read
      } else if (uploaded) {
        renderer.setNotes([])
        uploaded = null
      }

      const seconds = transport.playing ? transport.playhead(nowMs) : null
      if (view && seconds !== null) {
        const riding = pitch.enabled || trail.enabled
        const note = riding ? noteInContour(transport, seconds) : transport.noteAt(seconds)
        if (note) {
          onset = note.onB
          if (match?.onset !== onset) {
            match = null
            const found = settled
              ? locateNote(note, view, vp, read.notes, {
                  scaleX: transform.scaleX,
                  offsetX: transform.contentOffsetX,
                })
              : null
            if (found) {
              match = { onset, read, rect: found }
            }
          }
          // A match is also a statement about every other note in this read, so
          // it is kept as one. Notes that could not be matched — off the walked
          // set, or started while the roll was moving — are placed from it.
          if (match) {
            anchored = { anchor: anchorFromMatch(note, match.rect, view, read), read }
          }
          hit = match?.rect ?? (anchored ? anchoredRect(note, anchored.anchor) : null)
          const span = note.offS - note.onS
          // Not bounded to the note: a contour runs past both its ends, and the
          // effect is meant to run with it. Off the ends the fraction goes
          // outside 0..1 and the emission point leaves the rectangle sideways,
          // which is exactly where the curve has gone.
          progress = span > 0 ? (seconds - note.onS) / span : 0
          // Sparks and glow sound over the note itself, and run out into the
          // glide and the release only when they follow the pitch. The trail
          // goes there either way, so the window it is read over is wider.
          if (pitch.enabled || (progress >= 0 && progress < 1)) {
            struck = note.onB
          }
          if (riding) {
            const previous = transport.noteBefore(seconds)
            const sung = samplePitch(note, previous, seconds - note.onS, pitch.range)
            trailSemitones = sung.offset
            if (pitch.enabled) {
              if (pitch.mode !== "intensity") {
                offsetSemitones = sung.offset
              }
              if (pitch.mode !== "position") {
                boost = intensityScale(sung.speed, pitch.sensitivity)
              }
            }
          }
        }
      }
      if (debug && view && pitch.enabled && pitch.mode !== "intensity") {
        const xform = { scaleX: transform.scaleX, offsetX: transform.contentOffsetX }
        const bands: Rect[] = []
        for (const note of transport.notesBetween(view.mapping.viewLeft, view.mapping.viewRight)) {
          const rect = locateNote(note, view, vp, read.notes, xform)
          if (!rect) {
            continue
          }
          const { lowest, highest, overhang } = pitchExtent(
            note,
            transport.before(note),
            pitch.range,
          )
          bands.push(padRect(pitchBounds(rect, lowest, highest, overhang), REACH_PAD_PX))
        }
        reaches = bands
      }

      const noteStarted = struck !== null && struck !== soundingOnset
      soundingOnset = struck

      // The overlay window covers the whole SynthV window; map global screen
      // coords to window-local ones and clip to the note canvas so nothing draws
      // over the phoneme lane, piano keys, or toolbars.
      // The helper reports the window origin alongside the viewport when it can,
      // and that pair is sampled together; window.screenX updates on its own
      // schedule, so during a drag the two disagree and the drawing slides.
      const origin = vp.origin ?? { x: window.screenX, y: window.screenY }
      const frame = composeFrame(
        transform,
        vp,
        origin,
        hit,
        progress,
        offsetSemitones,
        trailSemitones,
      )
      updateDiagnostics(nowMs, frame.clip, latestViewport)
      renderer.draw({
        width: w,
        height: h,
        dpr,
        offsetX: frame.offsetX,
        offsetY: frame.offsetY,
        scaleX: frame.scaleX,
        clip: frame.clip,
        fill: FILL,
        stroke: STROKE,
        border: BORDER_PX,
        reaches,
        reachFill: REACH_FILL,
        reachStroke: REACH_STROKE,
        playing: debug ? hit : null,
        playingFill: PLAYING_FILL,
        emit: struck === null ? null : frame.emit,
        trailEmit: frame.trailEmit,
        particles: boost === 1 ? particles : { ...particles, rate: particles.rate * boost },
        noteStarted,
        glow: boost === 1 ? glow : { ...glow, level: Math.min(glow.level * boost, 1) },
        trail,
        audioMeter,
      })
      latencyProbe.sample({
        atMs: nowMs,
        frame: frameId,
        native: nativeCanvas,
        applied: latestViewport,
        drawStartedAtMs: nowMs,
        drawEndedAtMs: window.bridge.monotonicNow(),
      })
    }
    raf = requestAnimationFrame(draw)

    return () => {
      window.bridge.setDiagnosticsEnabled(false)
      canvasManager.stop()
      window.clearInterval(audioMeterTimer)
      void window.audioMeter.stop()
      cancelAnimationFrame(raf)
      unsubscribe()
      renderer.dispose()
    }
  }, [t])

  return (
    <div className="fixed inset-0 block h-full w-full">
      <div ref={hostRef} className="absolute inset-0" />
      <pre
        ref={diagnosticsRef}
        className="pointer-events-none absolute top-0 left-0 hidden whitespace-pre rounded bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white"
      />
      <canvas
        ref={diagnosticsGraphRef}
        className="pointer-events-none absolute top-0 left-0 hidden rounded"
      />
    </div>
  )
}
