import { Command } from 'commander'
import { loadMergedInstalled, getValidToken, API_URL } from '../lib/config.js'
import type { InstalledTeam } from '../types.js'

interface OrgTeamEntry {
  slug: string
  name: string
  description?: string | null
  owner: string
}

async function fetchOrgTeamList(orgSlug: string, token: string): Promise<OrgTeamEntry[]> {
  const res = await fetch(`${API_URL}/api/orgs/${orgSlug}/teams`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Org 팀 목록 조회 실패 (${res.status}): ${body}`)
  }
  return (await res.json()) as OrgTeamEntry[]
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('설치된 에이전트 팀 목록')
    .option('--org <slug>', 'Organization 팀 목록 조회')
    .action(async (opts: { org?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // --org 옵션: Org 팀 목록
      if (opts.org) {
        const orgSlug = opts.org

        const token = await getValidToken()
        if (!token) {
          if (json) {
            console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다. relay login을 먼저 실행하세요.', fix: 'relay login 실행 후 재시도하세요.' }))
          } else {
            console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
            console.error('  relay login을 먼저 실행하세요.')
          }
          process.exit(1)
        }

        try {
          const teams = await fetchOrgTeamList(orgSlug, token)

          if (json) {
            console.log(JSON.stringify({ org: orgSlug, teams }))
            return
          }

          if (teams.length === 0) {
            console.log(`\n@${orgSlug} Organization에 팀이 없습니다.`)
            return
          }

          console.log(`\n\x1b[1m@${orgSlug} 팀 목록\x1b[0m (${teams.length}개):\n`)
          for (const t of teams) {
            const desc = t.description
              ? `  \x1b[90m${t.description.length > 50 ? t.description.slice(0, 50) + '...' : t.description}\x1b[0m`
              : ''
            console.log(`  \x1b[36m@${t.owner}/${t.slug}\x1b[0m  \x1b[1m${t.name}\x1b[0m${desc}`)
          }
          console.log(`\n\x1b[33m  설치: relay install @${orgSlug}/<팀슬러그>\x1b[0m`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (json) {
            console.error(JSON.stringify({ error: 'FETCH_FAILED', message, fix: '네트워크 연결을 확인하거나 잠시 후 재시도하세요.' }))
          } else {
            console.error(`\x1b[31m오류: ${message}\x1b[0m`)
          }
          process.exit(1)
        }
        return
      }

      // 기본 동작: 글로벌 + 로컬 통합 목록
      const { global: globalInstalled, local: localInstalled } = loadMergedInstalled()

      interface ListEntry {
        slug: string
        version: string
        installed_at: string
        scope: 'global' | 'local'
        deploy_scope?: string
        org_slug?: string
      }

      const allEntries: ListEntry[] = []
      const seen = new Set<string>()

      // 글로벌 먼저
      for (const [slug, info] of Object.entries(globalInstalled) as [string, InstalledTeam][]) {
        allEntries.push({
          slug,
          version: info.version,
          installed_at: info.installed_at,
          scope: 'global',
          deploy_scope: info.deploy_scope,
          org_slug: info.org_slug,
        })
        seen.add(slug)
      }

      // 로컬 (글로벌과 중복되지 않는 것만)
      for (const [slug, info] of Object.entries(localInstalled) as [string, InstalledTeam][]) {
        if (seen.has(slug)) continue
        allEntries.push({
          slug,
          version: info.version,
          installed_at: info.installed_at,
          scope: 'local',
          deploy_scope: info.deploy_scope,
          org_slug: info.org_slug,
        })
      }

      if (json) {
        console.log(JSON.stringify({ installed: allEntries }))
      } else {
        if (allEntries.length === 0) {
          console.log('\n설치된 팀이 없습니다. `relay install <slug>`로 설치하세요.')
          return
        }
        console.log(`\n설치된 팀 (${allEntries.length}개):\n`)
        for (const item of allEntries) {
          const date = new Date(item.installed_at).toLocaleDateString('ko-KR')
          const scopeLabel = item.deploy_scope === 'global'
            ? '\x1b[32m글로벌\x1b[0m'
            : item.deploy_scope === 'local'
              ? '\x1b[33m로컬\x1b[0m'
              : '\x1b[90m미배치\x1b[0m'
          const orgLabel = item.org_slug ? `  \x1b[90m[Org: ${item.org_slug}]\x1b[0m` : ''
          console.log(`  \x1b[36m${item.slug}\x1b[0m  v${item.version}  ${scopeLabel}  (${date})${orgLabel}`)
        }
      }
    })
}
