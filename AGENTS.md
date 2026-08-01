# karaoke-v

Minimal Electron + React app (Turborepo + pnpm workspace). Apps live in `apps/*`.

## Commit & PR conventions

All **commit messages** and **PR titles** MUST follow
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

- **The scope is required** — always fill it in whenever it can reasonably be determined.
- **Choosing the scope:**
  - Changes to project-wide linting/formatting, build orchestration (Turborepo, root
    scripts), workspace config, or anything affecting the global/root area →
    use **`project`**. e.g. `chore(project): bump biome`, `ci(project): add typecheck job`.
  - Changes concentrated in one monorepo package → use **that package's name** (the
    package name without the `@karaoke-v/` prefix). e.g. for `@karaoke-v/app` →
    `feat(app): add settings screen`.

Common `type`s: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `perf`.

Examples:
- `feat(app): render playback controls`
- `fix(app): correct window sizing on macOS`
- `chore(project): configure turbo remote cache`
