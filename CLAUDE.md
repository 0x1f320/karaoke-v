# karaoke-v

Minimal Electron + React app (Turborepo + pnpm workspace). Apps live in `apps/*`.

## Code comments

**Do not write comments by default.** Names, types and small functions are expected to
carry the explanation; a comment that restates what the code already says is noise and
must not be added.

- Write a comment **only** when leaving it out could actually break the app or send the
  next reader down the wrong path: a non-obvious invariant, an ordering or lifecycle
  requirement, a workaround for a SynthV/Electron/macOS quirk, a native-boundary or
  memory-lifetime rule, or a "changing this crashes/deadlocks X" warning. When you do
  write one, say **why**, never what.
- **Never comment UI code.** Anything under `apps/*/src/renderer` — components, JSX,
  styles, layout, event handlers — gets no comments at all. If a piece of UI feels like
  it needs explaining, extract a well-named component, hook or constant instead.
- Existing comments are not a licence to add more; when you touch code whose comment has
  gone stale, fix or delete it.

## Commit & PR conventions

All **commit messages** and **PR titles** MUST follow
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

- **The scope is required** — always fill it in whenever it can reasonably be determined.
- The scope names the **feature area**, not the package or layer the code happens to
  live in. A single feature routinely spans `apps/karaoke-v` and
  `packages/macos-helper`; that is expected and does not change the scope.
- Use one of the scopes below. The list is expected to grow as the project does, but
  **never invent a scope on your own**: if a change genuinely does not fit any existing
  scope, stop and ask the developer whether to add one, and only then add it to this
  table in the same commit.

| Scope | Covers |
| --- | --- |
| `effects` | Note effects themselves — glow, particles, palettes, effect presets and their preview. |
| `overlay` | The piano-roll overlay surface: transparent window, Pixi stage, coordinate mapping, alignment through scroll/zoom. |
| `bridge` | The SynthV data channel: script API, clipboard and shared-memory transports, playhead/note/transport data and the shared types carrying it. |
| `native` | The platform helper add-ons (macOS, Windows): Accessibility/UI Automation probing, piano-roll geometry, window sticking and occlusion, their native builds. |
| `toolbar` | The floating toolbar and its controls. |
| `settings` | Settings window, preferences storage, and shared UI primitives. |
| `shell` | Electron app shell: process/window lifecycle, dev server and HMR, packaging and distribution. |
| `project` | Repo-wide concerns: linting/formatting, Turborepo and root scripts, workspace config, CI, docs about the repo itself. |

- **Picking between two scopes:** choose the area whose *behaviour* the change is
  about, not where the diff is biggest. Fixing AX geometry so the overlay stops
  drifting is `fix(overlay): …`; teaching the helper a new AX capability nothing yet
  consumes is `feat(native): …`.
- If a change really touches many areas at once, that is usually a sign it should be
  split into several commits.

Common `type`s: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `perf`.

Examples:
- `feat(effects): add a per-note glow falloff control`
- `fix(overlay): keep the overlay aligned through horizontal scroll and zoom`
- `fix(native): detect notes at the top of the piano roll`
- `feat(bridge): stream note lyrics from the SynthV script API`
- `chore(project): configure turbo remote cache`

## Language

Anything written into the repository or posted to GitHub is in **English**: commit
messages, PR titles, and **PR bodies**. This holds no matter which language the work is
being discussed in — a Korean conversation still produces an English PR body.
