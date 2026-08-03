import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { transform } from "@swc/core"
import { build } from "esbuild"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// SynthV loads one file and evaluates it in a bare Duktape host: no modules, no
// globals beyond `SV`, and no ES2015+ syntax. So the bundle is an IIFE that swc
// then lowers to ES5.
const bundle = await build({
  entryPoints: [resolve(root, "src/overlay-bridge.ts")],
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "esnext",
  charset: "utf8",
  alias: { "@": resolve(root, "src") },
  outdir: resolve(root, "out"),
  write: false,
})

await Promise.all(
  bundle.outputFiles.map(async (file) => {
    const { code } = await transform(file.text, {
      isModule: false,
      minify: false,
      jsc: {
        parser: { syntax: "ecmascript" },
        target: "es5",
        loose: true,
      },
    })
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, code)
    console.log(`synthv-script: built ${file.path}`)
  }),
)
