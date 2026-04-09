import { Command } from 'commander'
import { searchAgents } from '../lib/api.js'
import { trackCommand } from '../lib/step-tracker.js'
import type { SearchResult } from '../types.js'

function formatTable(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.'

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
    .description('Search for agents (public + your organization agents)')
    .option('--tag <tag>', 'Filter by tag')
    .option('--space <space>', 'Search within a specific Space')
    .action(async (keyword: string, opts: { tag?: string; space?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      trackCommand('search', { slug: keyword })
      try {
        const results = await searchAgents(keyword, opts.tag)
        if (json) {
          console.log(JSON.stringify({ results }))
        } else {
          const spaceSuffix = opts.space ? `  Space: \x1b[35m@${opts.space}\x1b[0m` : ''
          console.log(`\nQuery: \x1b[36m${keyword}\x1b[0m${opts.tag ? `  Tag: \x1b[33m${opts.tag}\x1b[0m` : ''}${spaceSuffix}\n`)
          console.log(formatTable(results))
          console.log(`\n${results.length} result(s)`)
          if (!opts.space && results.length === 0) {
            console.log('\x1b[33m💡 Search in your Space: anpm search <keyword> --space <space-slug>\x1b[0m')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(JSON.stringify({ error: 'SEARCH_FAILED', message, fix: 'Try different keywords or try again later.' }))
        process.exit(1)
      }
    })
}
