export function App() {
  return (
    <div className="flex h-full flex-col">
      {/* Full-width draggable title bar. Native window controls (macOS traffic
          lights / Windows overlay) float over their corners and stay clickable. */}
      <header className="app-drag relative h-10 flex-none select-none">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium text-neutral-300">
          karaoke-v
        </span>
      </header>
      <main className="flex flex-1 items-center justify-center">Hello World</main>
    </div>
  );
}
