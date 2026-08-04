const FIELD_WIDTH = 1600
const FIELD_HEIGHT = 420
const FOCAL = 900
const EYE_HEIGHT = 1
const NEAR_Z = (FOCAL * EYE_HEIGHT) / FIELD_HEIGHT
const FAR_Z = 9
const SPACING = 0.16
const DOT_RADIUS = 0.0075

const round = (value: number) => Math.round(value * 10) / 10

// The dots are billboards, not a texture lying on the plane: only their position and
// radius come from the perspective projection, so each one stays a circle facing the
// viewer instead of flattening into an ellipse as the plane turns away.
function projectDotRows() {
  const rows: { y: number; r: number; opacity: number; xs: number[] }[] = []

  for (let z = NEAR_Z; z <= FAR_Z; z += SPACING) {
    const depth = (z - NEAR_Z) / (FAR_Z - NEAR_Z)
    const columns = Math.ceil(((FIELD_WIDTH / 2) * (z / FOCAL)) / SPACING)
    const xs: number[] = []

    for (let column = -columns; column <= columns; column += 1) {
      const x = FIELD_WIDTH / 2 + (FOCAL * (column * SPACING)) / z
      if (x < 0 || x > FIELD_WIDTH) continue
      xs.push(round(x))
    }

    rows.push({
      y: round((FOCAL * EYE_HEIGHT) / z),
      r: round((FOCAL * DOT_RADIUS) / z),
      opacity: round(0.7 * (1 - depth) ** 1.5 + 0.08),
      xs,
    })
  }

  return rows
}

const DOT_ROWS = projectDotRows()

export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="hero-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <svg
        className="absolute inset-x-0 bottom-0 h-[72%] w-full"
        viewBox={`0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`}
        preserveAspectRatio="xMidYMax meet"
        fill="var(--color-dot)"
      >
        <title>Perspective dot field</title>
        {DOT_ROWS.map((row) => (
          <g key={row.y} opacity={row.opacity}>
            {row.xs.map((x) => (
              <circle key={x} cx={x} cy={row.y} r={row.r} />
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}
