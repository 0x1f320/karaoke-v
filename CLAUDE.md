# voxpane

Minimal Electron + React app (Turborepo + pnpm workspace). Apps live in `apps/*`.

## Required reading: `docs/`

This file is **conventions** — how to write a commit, where a test goes, how a string gets
translated. It says nothing about how the app *behaves*. That is in
**[`docs/`](docs/README.md)**, and it is not optional background: the product is split
across an Electron app, a Lua script running inside Synthesizer V, and two Rust helpers,
and none of the three explains the others. Working without it produces plausible code that
silently misplaces every effect.

**Before editing an area you have not already worked on in this session, read the whole
document listed against it** — not a grep of it. These are short, and what matters in them
is the invariants, which do not survive being skimmed for a keyword.

### What each document is

- **[docs/architecture.md](docs/architecture.md)** — the end-to-end path in three diagrams
  (data, geometry, main process); which process owns what and why the hot path lives in
  the preload; the frame loop step by step; the **three unsynchronised clocks** (script
  tick 16 ms, note pump ~30 ms plus a ~50 ms walk, rAF) and why they are not meant to
  agree; why decoders return `null` rather than throwing. **Read this before anything
  else** — it names every other layer, and most questions end here.
- **[docs/synthv.md](docs/synthv.md)** — the host application. Its object model down to the
  note, and that the bridge follows **one group only**. The four units (blick, second,
  semitone, cent) and which layer works in which. The Lua host: what it offers, and the
  absences — no `mkdir`, no sockets, no scheduler but `SV.setTimeout`, no log anyone
  outside SynthV can read — that shaped the bridge. The engine behaviours that are
  **measured, not documented**, above all that a computed pitch curve is often absent and
  that unvoiced frames come back as `0`, not `null`.
- **[docs/bridge.md](docs/bridge.md)** — the script ⇄ app channel: the three files and why
  they are split by change rate; `rev` / `notesSeq` pairing; the one-write-per-record
  atomicity rule and the two things it forces; the byte-level record layout; and **the
  three places a format change has to land at once**.
- **[docs/geometry.md](docs/geometry.md)** — where a note is on screen. The four coordinate
  spaces; why macOS reads rectangles out of the Accessibility tree while Windows computes
  them from the script's view transform, and why that split is deliberately not abstracted
  away; the DIP conversion; the three layered matching mechanisms (predict-and-snap,
  follow, anchor) and why each exists; and a table of **invariants against the symptom of
  breaking each one**.
- **[docs/overlay.md](docs/overlay.md)** — the window itself: why it is owned rather than
  topmost on Windows and why `WS_CHILD` is a dead end; how it follows SynthV's frame on each
  platform; drag prediction and the debounced bounds reconciliation; visibility and occlusion
  gating; and **why the per-frame path lives in the preload** with no IPC in it.
- **[docs/effects.md](docs/effects.md)** — what is actually drawn: glow, particles and trail
  as one document, the scene they share, pitch following and its synthesized fallback, and
  presets/images/the preview. Its **Techniques** section is the reference for the mechanisms
  the effects are built on — envelopes, pooling, reach parameterisation, quantized fade,
  rebasing — each with what breaks when it goes wrong.
- **[docs/debugging.md](docs/debugging.md)** — how to observe the running system: tray
  status, the script's side panel, `pnpm --filter @voxpane/synthv-script dump`, on-screen
  debug mode, deploying a script change, Windows, and a **symptom → technique** table. Read
  this **before investigating any bug**.

`docs/README.md` carries the routing tables: symptom → document, and a **technique index**
naming every non-obvious mechanism, its one home, and what uses it. Start there rather than
grepping.

### Which documents for which change

Keyed to the commit scopes below, so the answer is whatever scope the change already has.

| Scope | Read |
| --- | --- |
| `bridge` | architecture · **bridge** · synthv |
| `overlay` | architecture · **overlay** · geometry |
| `native` | architecture · **geometry** · overlay (and synthv for the script rescan) |
| `effects` | architecture · **effects** · geometry |
| `toolbar` | architecture · overlay (docking, and the follow loop it shares) |
| `settings` | architecture · effects (presets, imported images, the preview) |
| `shell` | architecture · overlay (window lifecycle, the permissions gate) |
| `project` | none required |

Any bug, in any scope, also gets **debugging.md**.

### Keeping them true

A stale document is worse than none: it is what the next reader trusts instead of the
code. **If a change makes a document wrong, fix the document in the same commit.** That is
a `docs` type only when documentation is the whole change; otherwise it rides along with
the behaviour change that caused it.

Each document has a Korean translation beside it — `architecture.md` / `architecture.ko.md`.
**English is the source of truth**, and the translation is brought level in the same commit;
see **Language** below for the rules that keep the pair from drifting apart.

## Native addons

Both platform helpers — `packages/macos-helper` and `packages/windows-helper` — are
**Rust + napi-rs**, so a checkout needs a Rust toolchain (`rustup`) as well as Node.

- `pnpm build` runs `napi build`, which writes the `.node` plus a generated
  `binding.js`/`binding.d.ts` next to it. All three are build output and none are
  committed; `Cargo.lock` is. On macOS it builds **both** `aarch64` and `x86_64`
  slices, because the app ships as a universal bundle and the loader picks one by
  `process.arch` at runtime.
- The public surface stays the hand-written `index.js` / `index.d.ts`. They require
  the generated loader **lazily**, because `shared/native.ts` imports both packages
  on both platforms and only one of them has a binary.
- **Nothing is rebuilt for Electron.** Node-API keeps one binary loadable by both
  Node and Electron, and `@electron/rebuild` cannot drive Cargo anyway — there is no
  `rebuild:native` step, and `dev` depends on `^build` instead.
- The Windows crate is `#[cfg(windows)]` throughout, so it builds empty elsewhere.
  From a macOS checkout, `cargo check --target x86_64-pc-windows-msvc` inside
  `packages/windows-helper` is what actually compiles that code.

## Packaging

`pnpm package` builds the installers with electron-builder over the `electron-vite`
output: a **universal** dmg + zip on macOS, an NSIS installer on Windows, plus the
`latest*.yml` and blockmaps the auto-updater will consume. Config lives in
`apps/voxpane/electron-builder.yml`, the icon in `apps/voxpane/build/`
(`icon.svg` is the source, `icon.png` is what electron-builder converts). Signing and
notarization are not set up yet, so a local build is unsigned.

- The app's **`dependencies` are only what the packaged app resolves at runtime** —
  electron-builder copies them into the installer verbatim. The renderer is bundled
  whole by Vite, so react, pixi and friends belong in `devDependencies`; putting one
  back into `dependencies` ships it a second time.
- Assets are reached through `resourcePath()`, which is `process.resourcesPath` once
  packaged, so anything new under `resources/` needs no config change.

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

## User-facing text (i18n)

The app ships in **ko / en / ja**, so **no user-facing string may be written as a literal**
— not in a component, not in a tray menu, window title or notification. Every one of them
is an i18next key. A change that adds UI text is **not finished** until all three locale
files carry the key.

- Resources live in `apps/voxpane/src/shared/i18n/locales/{ko,en,ja}.json`. Keys are
  grouped by the surface that shows them (`settings.*`, `tray.*`, `permissions.*`, …);
  **ko is the source of truth** for wording, and `en` is the fallback for anything missing.
- **Renderer:** `const { t } = useTranslation()`. **Main:** `t` from `src/main/i18n.ts`.
  Anything main builds once and leaves standing — the tray menu, a window title — must
  re-spell itself from `onLanguageChanged`, or it will keep the old language on screen.
- **Never spell a product name in a translation.** `{{app}}` and `{{synthv}}` are supplied
  as i18next default variables from `src/shared/i18n/index.ts`.
- **Units and suffixes are text too** (`units.seconds`, `units.times`, …). Do not append
  `초`/`s`/`秒` in a template literal.
- Write each key as a **whole sentence** and never assemble one from fragments: Korean
  particles (을/를, 이/가) and word order do not survive being reused by another language.
- The chosen language is the `language` preference (`"system"` plus the supported list);
  `resolveLanguage` in `src/shared/language.ts` turns it into the one actually rendered.
  Adding a language means a locale file plus an entry in `LANGUAGES` — nothing else.

## Tests

Vitest, Node environment. A test sits next to the file it covers, as
`<module>.test.ts` — `preferences.ts` is tested by `preferences.test.ts` beside it,
never by a mirror tree somewhere else. `pnpm test` at the root runs them through
Turborepo; CI and the pre-commit hook run the same task.

They cover the pure logic only: bridge parsing, preferences merge/sanitize, the
transport clock, note location, the frame math and the DIP transforms. Anything that
needs Electron, the native add-ons or a real piano roll is out of scope — keep new
logic testable by extracting it into a pure function rather than by mocking the world.

## Commit & PR conventions

All **commit messages** and **PR titles** MUST follow
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

- **The scope is required** — always fill it in whenever it can reasonably be determined.
- The scope names the **feature area**, not the package or layer the code happens to
  live in. A single feature routinely spans `apps/voxpane` and
  `packages/macos-helper`; that is expected and does not change the scope.
- Use one of the scopes below. The list is expected to grow as the project does, but
  **never invent a scope on your own**: if a change genuinely does not fit any existing
  scope, stop and ask the developer whether to add one, and only then add it to this
  table in the same commit.

| Scope | Covers |
| --- | --- |
| `effects` | Note effects themselves — glow, particles, palettes, effect presets and their preview. |
| `overlay` | The piano-roll overlay surface: transparent window, Pixi stage, coordinate mapping, alignment through scroll/zoom. |
| `bridge` | The SynthV data channel: the Lua bridge script, the file channels and their wire format, playhead/note/transport data and the shared types carrying it. |
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

**The one exception is `docs/`**, which is bilingual: `<name>.md` in English and
`<name>.ko.md` in Korean. **English is the source of truth.** A behaviour change edits the
English document first and brings the translation level **in the same commit** — a
translation that has drifted is worse than none, because it is what the next reader trusts
instead of the code.

- **Technical terms and proper nouns stay in English** inside the Korean documents:
  `playhead`, `viewport`, `envelope`, `rebasing`, `blick`, and every identifier. Translating
  them severs the link to the code and gives one concept two names.
- **Headings stay identical to the English original**, so the two files share anchors and a
  link into a section lands in the same place in either language.
- Nothing else in the repository is translated. This exists because `docs/` is the one part
  of the tree written to be *read* rather than executed.
