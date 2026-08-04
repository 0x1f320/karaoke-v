export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      className="hero-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="dot-plane-viewport absolute inset-x-0 bottom-0 h-[72%]">
        <div className="dot-plane absolute -inset-x-full bottom-0 h-[900%]" />
      </div>
    </div>
  )
}
