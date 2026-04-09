import fs from 'fs'
import { Command } from 'commander'
import { loadMergedInstalled, getValidToken, API_URL } from '../lib/config.js'
import type { InstalledAgent } from '../types.js'
import { AI_TOOLS } from '../lib/ai-tools.js'

interface OrgAgentEntry {
  slug: string
  name: string
  description?: string | null
  owner: string
}

async function fetchOrgAgentList(orgSlug: string, token: string): Promise<OrgAgentEntry[]> {
  const res = await fetch(`${API_URL}/api/orgs/${orgSlug}/agents`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Org 에이전트 목록 조회 실패 (${res.status}): ${body}`)
  }
  return (await res.json()) as OrgAgentEntry[]
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List installed agents')
    .option('--org <slug>', 'List organization agents')
    .option('--detail', 'Show file-level symlink mapping per agent')
    .action(async (opts: { org?: string; detail?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // --org 옵션: Org 에이전트 목록
      if (opts.org) {
        const orgSlug = opts.org

        const token = await getValidToken()
        if (!token) {
          if (json) {
            console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다. anpm login을 먼저 실행하세요.', fix: 'anpm login 실행 후 재시도하세요.' }))
          } else {
            console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
            console.error('  anpm login을 먼저 실행하세요.')
          }
          process.exit(1)
        }

        try {
          const agents = await fetchOrgAgentList(orgSlug, token)

          if (json) {
            console.log(JSON.stringify({ org: orgSlug, agents }))
            return
          }

          if (agents.length === 0) {
            console.log(`\n@${orgSlug} Organization에 에이전트가 없습니다.`)
            return
          }

          console.log(`\n\x1b[1m@${orgSlug} 에이전트 목록\x1b[0m (${agents.length}개):\n`)
          for (const t of agents) {
            const desc = t.description
              ? `  \x1b[90m${t.description.length > 50 ? t.description.slice(0, 50) + '...' : t.description}\x1b[0m`
              : ''
            console.log(`  \x1b[36m@${t.owner}/${t.slug}\x1b[0m  \x1b[1m${t.name}\x1b[0m${desc}`)
          }
          console.log(`\n\x1b[33m  설치: anpm install @${orgSlug}/<에이전트슬러그>\x1b[0m`)
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
        source?: string
        symlinks?: string[]
      }

      const allEntries: ListEntry[] = []
      const seen = new Set<string>()

      // 글로벌 먼저
      for (const [slug, info] of Object.entries(globalInstalled) as [string, InstalledAgent][]) {
        allEntries.push({
          slug,
          version: info.version,
          installed_at: info.installed_at,
          scope: 'global',
          deploy_scope: info.deploy_scope,
          org_slug: info.org_slug,
          source: info.source,
          symlinks: info.deployed_symlinks,
        })
        seen.add(slug)
      }

      // Local (not already in global)
      for (const [slug, info] of Object.entries(localInstalled) as [string, InstalledAgent][]) {
        if (seen.has(slug)) continue
        allEntries.push({
          slug,
          version: info.version,
          installed_at: info.installed_at,
          scope: 'local',
          deploy_scope: info.deploy_scope,
          org_slug: info.org_slug,
          source: info.source,
          symlinks: info.deployed_symlinks,
        })
      }

      if (json) {
        console.log(JSON.stringify({ installed: allEntries }))
      } else {
        if (allEntries.length === 0) {
          console.log('\nNo agents installed. Run `anpm install <slug>` to install one.')
          return
        }
        console.log(`\nInstalled agents (${allEntries.length}):\n`)
        for (const item of allEntries) {
          const date = new Date(item.installed_at).toLocaleDateString('en-US')
          const scopeLabel = item.deploy_scope === 'global'
            ? '\x1b[32mglobal\x1b[0m'
            : item.deploy_scope === 'local'
              ? '\x1b[33mlocal\x1b[0m'
              : '\x1b[90m—\x1b[0m'
          const sourceLabel = item.source
            ? `  \x1b[90m${item.source.split(':')[0]}\x1b[0m`
            : ''
          const orgLabel = item.org_slug ? `  \x1b[90m[Org: ${item.org_slug}]\x1b[0m` : ''
          console.log(`  \x1b[36m${item.slug}\x1b[0m  v${item.version}  ${scopeLabel}${sourceLabel}  (${date})${orgLabel}`)

          // --detail: show per-file symlink mapping
          if (opts.detail && item.symlinks && item.symlinks.length > 0) {
            for (const link of item.symlinks) {
              const exists = fs.existsSync(link)
              const icon = exists ? '✅' : '❌'
              // Extract harness + content type from path
              const harnessName = AI_TOOLS.find((t) => link.includes(t.skillsDir))?.name ?? '?'
              const parts = link.split('/')
              const contentIdx = parts.findIndex((p) => ['skills', 'commands', 'rules', 'agents'].includes(p))
              const contentLabel = contentIdx >= 0 ? parts.slice(contentIdx).join('/') : link
              console.log(`    ${icon} ${contentLabel}  \x1b[90m→ ${harnessName}\x1b[0m`)
            }
          }
        }
      }
    })
}
