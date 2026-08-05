import { readFile, writeFile } from "node:fs/promises"

const version = process.argv[2]

if (!version) {
  throw new Error("Usage: node .github/scripts/set-release-version.mjs <version>")
}

const files = ["package.json", "apps/voxpane/package.json"]

await Promise.all(
  files.map(async (file) => {
    const json = JSON.parse(await readFile(file, "utf8"))
    json.version = version
    await writeFile(file, `${JSON.stringify(json, null, 2)}\n`)
  }),
)
