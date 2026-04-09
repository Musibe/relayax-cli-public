import { Command } from 'commander'
import { fetchAgentVersions } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'

export function registerVersions(program: Command): void {
  program
    .command('versions <slug>')
    .description('List agent versions and release notes')
    .action(async (slugInput: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      try {
        const resolved = await resolveSlug(slugInput)
        const versions = await fetchAgentVersions(resolved.full)

        if (json) {
          console.log(JSON.stringify({ slug: resolved.full, versions }))
          return
        }

        if (versions.length === 0) {
          console.log(`\n${resolved.full} has no version history.`)
          return
        }

        console.log(`\n\x1b[1m${resolved.full} version history\x1b[0m (${versions.length}):\n`)
        for (const v of versions) {
          const date = new Date(v.created_at).toLocaleDateString('en-US')
          console.log(`  \x1b[36mv${v.version}\x1b[0m  (${date})`)
          if (v.changelog) {
            console.log(`    \x1b[90m${v.changelog}\x1b[0m`)
          }
        }
        console.log(`\n\x1b[33m  Install specific version: anpm install ${resolved.full}@<version>\x1b[0m`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'VERSIONS_FAILED', message }))
        } else {
          console.error(`\x1b[31mError: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
