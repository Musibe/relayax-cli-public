import { Command } from 'commander'
import { sendUsagePing } from '../lib/api.js'
import { loadInstalled, loadGlobalInstalled } from '../lib/config.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'

export function registerPing(program: Command): void {
  program
    .command('ping <slug>', { hidden: true })
    .description('Record usage (lightweight preamble command)')
    .option('--quiet', 'Run without output')
    .action(async (slugInput: string, opts: { quiet?: boolean }) => {
      // Resolve slug
      let slug: string
      if (isScopedSlug(slugInput)) {
        slug = slugInput
      } else {
        const localRegistry = loadInstalled()
        const globalRegistry = loadGlobalInstalled()
        const allKeys = [...Object.keys(localRegistry), ...Object.keys(globalRegistry)]
        const match = allKeys.find((key) => {
          const parsed = parseSlug(key)
          return parsed && parsed.name === slugInput
        })
        slug = match ?? slugInput
      }

      // Resolve version and agent_id from installed registry
      const local = loadInstalled()
      const global = loadGlobalInstalled()
      const entry = local[slug] ?? global[slug]
      const version = entry?.version
      const agentId = entry?.agent_id

      // Fire-and-forget ping (falls back to slug if no agent_id)
      await sendUsagePing(agentId ?? null, slug, version)

      if (!opts.quiet) {
        console.log(`RELAY_READY: ${slug}`)
      }
    })
}
