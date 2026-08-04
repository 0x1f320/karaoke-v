const EDGES = [0, 100]
const THIRDS = [100 / 3, (100 / 3) * 2]
const QUARTERS = [25, 50, 75]

export function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-frame px-gutter">{children}</div>
}

export function FrameLines() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div className="mx-auto h-full w-full max-w-frame px-gutter">
        <div className="relative h-full">
          {EDGES.map((left) => (
            <span
              key={left}
              style={{ left: `${left}%` }}
              className="absolute top-0 h-full w-px -translate-x-1/2 bg-rule"
            />
          ))}
          {QUARTERS.map((left) => (
            <span
              key={left}
              style={{ left: `${left}%` }}
              className="absolute top-0 hidden h-full w-px -translate-x-1/2 bg-rule lg:block"
            />
          ))}
          {THIRDS.map((left) => (
            <span
              key={left}
              style={{ left: `${left}%` }}
              className="absolute top-0 hidden h-full w-px -translate-x-1/2 bg-rule sm:block"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Crosshair({ left, className }: { left: number; className?: string }) {
  return (
    <span
      style={{ left: `${left}%` }}
      className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 ${className ?? ""}`}
    >
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-rule-strong" />
      <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-rule-strong" />
    </span>
  )
}

export function FrameRule() {
  return (
    <div aria-hidden className="relative h-px w-full bg-rule">
      {EDGES.map((left) => (
        <Crosshair key={left} left={left} />
      ))}
      {QUARTERS.map((left) => (
        <Crosshair key={left} left={left} className="hidden lg:block" />
      ))}
      {THIRDS.map((left) => (
        <Crosshair key={left} left={left} className="hidden sm:block" />
      ))}
    </div>
  )
}
