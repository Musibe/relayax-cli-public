import { Command } from 'commander'
import { fetchTeamVersions } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'

export function registerVersions(program: Command): void {
  program
    .command('versions <slug>')
    .description('팀 버전 목록과 릴리즈 노트를 확인합니다')
    .action(async (slugInput: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      try {
        const resolved = await resolveSlug(slugInput)
        const versions = await fetchTeamVersions(resolved.full)

        if (json) {
          console.log(JSON.stringify({ slug: resolved.full, versions }))
          return
        }

        if (versions.length === 0) {
          console.log(`\n${resolved.full} 버전 이력이 없습니다.`)
          return
        }

        console.log(`\n\x1b[1m${resolved.full} 버전 이력\x1b[0m (${versions.length}개):\n`)
        for (const v of versions) {
          const date = new Date(v.created_at).toLocaleDateString('ko-KR')
          console.log(`  \x1b[36mv${v.version}\x1b[0m  (${date})`)
          if (v.changelog) {
            console.log(`    \x1b[90m${v.changelog}\x1b[0m`)
          }
        }
        console.log(`\n\x1b[33m  특정 버전 설치: relay install ${resolved.full}@<version>\x1b[0m`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'VERSIONS_FAILED', message }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
