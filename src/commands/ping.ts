import { Command } from 'commander'
import { sendUsagePing } from '../lib/api.js'
import { loadInstalled, loadGlobalInstalled } from '../lib/config.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'

export function registerPing(program: Command): void {
  program
    .command('ping <slug>')
    .description('사용 현황을 기록합니다 (preamble용 경량 명령)')
    .option('--quiet', '출력 없이 실행')
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

      // Resolve version and team_id from installed registry
      const local = loadInstalled()
      const global = loadGlobalInstalled()
      const entry = local[slug] ?? global[slug]
      const version = entry?.version
      const teamId = entry?.team_id

      // Fire-and-forget ping (team_id 기반, 없으면 skip)
      if (teamId) {
        await sendUsagePing(teamId, slug, version)
      }

      if (!opts.quiet) {
        console.log(`RELAY_READY: ${slug}`)
      }
    })
}
