import { Command } from 'commander'
import { checkCliVersion, checkAgentVersion, checkAllAgents } from '../lib/version-check.js'
import { resolveSlug, isScopedSlug } from '../lib/slug.js'

export function registerCheckUpdate(program: Command): void {
  program
    .command('check-update [slug]')
    .description('CLI 및 설치된 에이전트의 업데이트를 확인합니다')
    .option('--quiet', '업데이트가 있을 때만 머신 리더블 출력')
    .option('--force', '캐시를 무시하고 강제 체크')
    .action(async (slug: string | undefined, opts: { quiet?: boolean; force?: boolean }) => {
      const quiet = opts.quiet ?? false
      const force = opts.force ?? false

      // CLI version check
      const cliResult = await checkCliVersion(force)
      if (cliResult) {
        if (quiet) {
          console.log(`CLI_UPGRADE_AVAILABLE ${cliResult.current} ${cliResult.latest}`)
        } else {
          console.log(`\n\x1b[33m⚠ relay v${cliResult.latest} available\x1b[0m (현재 v${cliResult.current})`)
          console.log(`  실행: npm update -g relayax-cli\n`)
        }
      }

      // Agent version check
      if (slug) {
        // Resolve to scoped slug
        let scopedSlug: string
        if (isScopedSlug(slug)) {
          scopedSlug = slug
        } else {
          try {
            const parsed = await resolveSlug(slug)
            scopedSlug = parsed.full
          } catch {
            scopedSlug = slug
          }
        }
        const agentResult = await checkAgentVersion(scopedSlug, force)
        if (agentResult) {
          if (quiet) {
            const byAuthor = agentResult.author ? ` ${agentResult.author}` : ''
            console.log(`AGENT_UPGRADE_AVAILABLE ${slug} ${agentResult.current} ${agentResult.latest}${byAuthor}`)
          } else {
            const byAuthor = agentResult.author ? ` \x1b[90m(by @${agentResult.author})\x1b[0m` : ''
            console.log(`\x1b[33m⚠ ${slug} v${agentResult.latest} available\x1b[0m${byAuthor} (현재 v${agentResult.current})`)
            console.log(`  실행: relay update ${slug}`)
          }
        } else if (!quiet && !cliResult) {
          console.log('모든 것이 최신 상태입니다.')
        }
      } else {
        const agentResults = await checkAllAgents(force)
        for (const result of agentResults) {
          if (quiet) {
            const byAuthor = result.author ? ` ${result.author}` : ''
            console.log(`AGENT_UPGRADE_AVAILABLE ${result.slug} ${result.current} ${result.latest}${byAuthor}`)
          } else {
            const byAuthor = result.author ? ` \x1b[90m(by @${result.author})\x1b[0m` : ''
            console.log(`\x1b[33m⚠ ${result.slug} v${result.latest} available\x1b[0m${byAuthor} (현재 v${result.current})`)
            console.log(`  실행: relay update ${result.slug}`)
          }
        }
        if (!quiet && !cliResult && agentResults.length === 0) {
          console.log('모든 것이 최신 상태입니다.')
        }
      }
    })
}
