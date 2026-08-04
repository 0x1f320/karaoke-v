import { Frame, FrameRule } from "@/components/frame"

const CAPABILITIES = [
  {
    index: "01",
    title: "Sticks to the window",
    body: "Tracks Synthesizer V Studio through moves, scrolls and zooms.",
  },
  {
    index: "02",
    title: "Reads the score",
    body: "A bridge script streams the playhead, pitches and lyrics.",
  },
  {
    index: "03",
    title: "Tunable",
    body: "Glow, particles and palettes are presets you can edit.",
  },
]

export default function HomePage() {
  return (
    <Frame>
      <header className="flex h-16 items-center justify-between text-sm">
        <span className="font-medium tracking-tight">karaoke-v</span>
        <a
          href="https://github.com/0x1f320/karaoke-v"
          target="_blank"
          rel="noreferrer"
          className="text-muted transition-colors hover:text-fg"
        >
          GitHub
        </a>
      </header>

      <FrameRule />

      <section className="flex min-h-[70dvh] flex-col justify-center py-16">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">Coming soon</p>
        <h1 className="mt-8 max-w-3xl text-5xl leading-[1.05] font-medium tracking-tight text-balance sm:text-7xl">
          The piano roll, lit up.
        </h1>
        <p className="mt-8 max-w-xl text-lg text-pretty text-muted">
          A live effects overlay for Synthesizer V Studio, following the playhead note by note on
          macOS and Windows.
        </p>
      </section>

      <FrameRule />

      <section className="grid grid-cols-1 sm:grid-cols-3">
        {CAPABILITIES.map((capability) => (
          <article
            key={capability.index}
            className="border-rule py-12 not-last:border-b sm:border-b-0 sm:pr-8"
          >
            <span className="font-mono text-xs tracking-widest text-muted">{capability.index}</span>
            <h2 className="mt-6 font-medium tracking-tight">{capability.title}</h2>
            <p className="mt-2 text-sm text-pretty text-muted">{capability.body}</p>
          </article>
        ))}
      </section>

      <FrameRule />

      <footer className="flex h-16 items-center justify-between text-sm text-muted">
        <span>MIT licensed</span>
        <span className="font-mono text-xs tracking-widest">2026</span>
      </footer>
    </Frame>
  )
}
