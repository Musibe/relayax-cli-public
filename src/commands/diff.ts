import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { fetchAgentVersions, fetchAgentInfo } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'
import { checkGitInstalled, gitClone, gitDiff } from '../lib/git-operations.js'

export function registerDiff(program: Command): void {
  program
    .command('diff <slug> <v1> <v2>')
    .description('Compare two versions of a package')
    .action(async (slugInput: string, v1: string, v2: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      try {
        const resolved = await resolveSlug(slugInput)
        const versions = await fetchAgentVersions(resolved.full)
        const info = await fetchAgentInfo(resolved.full)

        const ver1 = versions.find((v) => v.version === v1)
        const ver2 = versions.find((v) => v.version === v2)

        if (!ver1 || !ver2) {
          throw new Error(`Version not found. Available: ${versions.map((v) => v.version).join(', ')}`)
        }

        if (!json) {
          console.log(`\n\x1b[1m${resolved.full}\x1b[0m v${v1} ↔ v${v2} comparing...\n`)
        }

        // Use git diff if git_url is available
        if (info.git_url) {
          checkGitInstalled()
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-diff-'))

          try {
            gitClone(info.git_url, tempDir)
            const diffOutput = gitDiff(tempDir, `v${v1}`, `v${v2}`)

            if (json) {
              console.log(JSON.stringify({
                slug: resolved.full,
                v1: { version: v1, created_at: ver1.created_at, changelog: ver1.changelog },
                v2: { version: v2, created_at: ver2.created_at, changelog: ver2.changelog },
                diff: diffOutput,
              }))
            } else {
              if (diffOutput.trim()) {
                console.log(diffOutput)
              } else {
                console.log('  No changes found.')
              }
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
          }
        } else {
          // Fallback: show version info only (no git URL available)
          if (json) {
            console.log(JSON.stringify({
              slug: resolved.full,
              v1: { version: v1, created_at: ver1.created_at, changelog: ver1.changelog },
              v2: { version: v2, created_at: ver2.created_at, changelog: ver2.changelog },
            }))
          } else {
            console.log(`  v${v1} (${new Date(ver1.created_at).toLocaleDateString('en-US')})`)
            if (ver1.changelog) console.log(`    ${ver1.changelog}`)
            console.log()
            console.log(`  v${v2} (${new Date(ver2.created_at).toLocaleDateString('en-US')})`)
            if (ver2.changelog) console.log(`    ${ver2.changelog}`)
            console.log()
            console.log(`\x1b[33m  Git-based diff is only supported for newly published agents.\x1b[0m`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'DIFF_FAILED', message }))
        } else {
          console.error(`\x1b[31mError: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
