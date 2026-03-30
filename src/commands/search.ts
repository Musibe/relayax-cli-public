import { Command } from 'commander'
import { searchTeams } from '../lib/api.js'
import type { SearchResult } from '../types.js'

function formatTable(results: SearchResult[]): string {
  if (results.length === 0) return '검색 결과가 없습니다.'

  const rows = results.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description.length > 50
      ? r.description.slice(0, 47) + '...'
      : r.description,
    installs: String(r.install_count),
    commands: r.commands.map((c: string | { name: string }) => typeof c === 'string' ? c : c.name).join(', ') || '-',
  }))

  const cols = ['slug', 'name', 'description', 'installs', 'commands'] as const
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => r[col].length))
  )

  const header = cols
    .map((col, i) => col.padEnd(widths[i]))
    .join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const lines = rows.map((row) =>
    cols.map((col, i) => row[col].padEnd(widths[i])).join('  ')
  )

  return ['\x1b[1m' + header + '\x1b[0m', separator, ...lines].join('\n')
}

export function registerSearch(program: Command): void {
  program
    .command('search <keyword>')
    .description('Space에서 에이전트 팀 검색 (공개 팀 + 내 Space 팀)')
    .option('--tag <tag>', '태그로 필터링')
    .option('--space <space>', '특정 Space 내에서 검색')
    .action(async (keyword: string, opts: { tag?: string; space?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      try {
        const results = await searchTeams(keyword, opts.tag)
        if (json) {
          console.log(JSON.stringify({ results }))
        } else {
          const spaceSuffix = opts.space ? `  Space: \x1b[35m@${opts.space}\x1b[0m` : ''
          console.log(`\n검색어: \x1b[36m${keyword}\x1b[0m${opts.tag ? `  태그: \x1b[33m${opts.tag}\x1b[0m` : ''}${spaceSuffix}\n`)
          console.log(formatTable(results))
          console.log(`\n총 ${results.length}건`)
          if (!opts.space && results.length === 0) {
            console.log('\x1b[33m💡 내 Space에서 검색하려면: relay search <keyword> --space <space-slug>\x1b[0m')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(JSON.stringify({ error: 'SEARCH_FAILED', message, fix: '검색어를 변경하거나 잠시 후 재시도하세요.' }))
        process.exit(1)
      }
    })
}
