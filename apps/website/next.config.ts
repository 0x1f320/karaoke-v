import type { NextConfig } from "next"

// Agentation is a dev-only toolbar, but `NODE_ENV` dead-code elimination does not
// reach across the module boundary: without this alias its ~400 kB ships in the
// production bundle.
const config: NextConfig = {
  turbopack: {
    resolveAlias:
      process.env.NODE_ENV === "production" ? { agentation: "./src/dev/agentation-stub.tsx" } : {},
  },
}

export default config
