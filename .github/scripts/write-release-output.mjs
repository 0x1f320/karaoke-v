import { appendFile } from "node:fs/promises"

const [version, tag] = process.argv.slice(2)
const output = process.env.GITHUB_OUTPUT

if (!version || !tag) {
  throw new Error("Usage: node .github/scripts/write-release-output.mjs <version> <tag>")
}

if (output) {
  await appendFile(output, `released=true\nversion=${version}\ntag=${tag}\n`)
}
