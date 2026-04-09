import { Command } from 'commander'
import { fetchAgentInfo, sendUsagePing } from '../lib/api.js'
import { loadInstalled } from '../lib/config.js'
import { checkCliVersion } from '../lib/version-check.js'

interface OutdatedEntry {
  slug: string
  current: string
  latest: string
  status: 'outdated' | 'up-to-date' | 'unknown'
}

export function registerOutdated(program: Command): void {
  program
    .command('outdated')
    .description('CLI 및 설치된 에이전트의 업데이트 가능 여부를 확인합니다')
    .option('--force', '캐시를 무시하고 강제 체크')
    .action(async (opts: { force?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const force = opts.force ?? false
      const installed = loadInstalled()
      const slugs = Object.keys(installed)

      // CLI version check
      const cliResult = await checkCliVersion(force)

      if (slugs.length === 0 && !cliResult) {
        if (json) {
          console.log(JSON.stringify({ cli: null, agents: [] }))
        } else {
          console.log('모든 것이 최신 상태입니다.')
        }
        return
      }

      // Send usage pings (fire-and-forget)
      for (const slug of slugs) {
        const entry = installed[slug]
        sendUsagePing(entry.agent_id ?? null, slug, entry.version).catch(() => {})
      }

      // Fetch latest versions in parallel
      const results: OutdatedEntry[] = await Promise.all(
        slugs.map(async (slug): Promise<OutdatedEntry> => {
          const current = installed[slug].version
          try {
            const agent = await fetchAgentInfo(slug)
            const latest = agent.version
            return {
              slug,
              current,
              latest,
              status: current === latest ? 'up-to-date' : 'outdated',
            }
          } catch {
            return { slug, current, latest: '?', status: 'unknown' }
          }
        })
      )

      if (json) {
        console.log(JSON.stringify({
          cli: cliResult ? { current: cliResult.current, latest: cliResult.latest } : null,
          agents: results,
        }))
        return
      }

      // CLI update info at top
      if (cliResult) {
        console.log(`\x1b[33m⚠ anpm v${cliResult.latest} available\x1b[0m (현재 v${cliResult.current})`)
        console.log(`  실행: npm update -g anpm-io`)
        if (slugs.length > 0) console.log('')
      }

      const allUpToDate = results.every((r) => r.status === 'up-to-date')
      if (allUpToDate && !cliResult) {
        console.log('모든 것이 최신 상태입니다.')
        return
      }

      if (allUpToDate) {
        console.log('모든 에이전트가 최신 버전입니다.')
        return
      }

      // Determine column widths
      const COL_TEAM = Math.max(9, ...results.map((r) => r.slug.length))
      const COL_CURRENT = Math.max(4, ...results.map((r) => `v${r.current}`.length))
      const COL_LATEST = Math.max(4, ...results.map((r) => `v${r.latest}`.length))

      const pad = (s: string, len: number) => s.padEnd(len)

      const header = `${pad('에이전트', COL_TEAM)}  ${pad('현재', COL_CURRENT)}  ${pad('최신', COL_LATEST)}  상태`
      const separator = '-'.repeat(header.length)

      console.log(header)
      console.log(separator)

      for (const entry of results) {
        const statusLabel =
          entry.status === 'outdated'
            ? '\x1b[33m업데이트 가능\x1b[0m'
            : entry.status === 'up-to-date'
            ? '\x1b[32m✓ 최신\x1b[0m'
            : '\x1b[31m조회 실패\x1b[0m'

        const slugCol = pad(entry.slug, COL_TEAM)
        const currentCol = pad(`v${entry.current}`, COL_CURRENT)
        const latestCol = pad(`v${entry.latest}`, COL_LATEST)

        console.log(`${slugCol}  ${currentCol}  ${latestCol}  ${statusLabel}`)
      }
    })
}
