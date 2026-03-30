import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { fetchAgentVersions, fetchAgentInfo } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'
import { downloadPackage, extractPackage, makeTempDir, removeTempDir } from '../lib/storage.js'
import { execSync } from 'child_process'

export function registerDiff(program: Command): void {
  program
    .command('diff <slug> <v1> <v2>')
    .description('두 버전의 패키지를 비교합니다')
    .action(async (slugInput: string, v1: string, v2: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      try {
        const resolved = await resolveSlug(slugInput)
        const versions = await fetchAgentVersions(resolved.full)

        const ver1 = versions.find((v) => v.version === v1)
        const ver2 = versions.find((v) => v.version === v2)

        if (!ver1 || !ver2) {
          throw new Error(`버전을 찾을 수 없습니다. 사용 가능: ${versions.map((v) => v.version).join(', ')}`)
        }

        if (!json) {
          console.log(`\n\x1b[1m${resolved.full}\x1b[0m v${v1} ↔ v${v2} 비교 중...\n`)
        }

        // Download both versions to temp dirs
        const tempDir1 = makeTempDir()
        const tempDir2 = makeTempDir()

        try {
          // Get download URLs for both versions via registry API
          // For now, we use the current version's package_url as fallback
          // The registry API returns the latest version; for specific versions,
          // we'd need a version-specific endpoint
          const info = await fetchAgentInfo(resolved.full)

          if (!info.package_url) {
            throw new Error('패키지 URL을 가져올 수 없습니다')
          }

          // Since version-specific download isn't available yet, show versions info
          if (json) {
            console.log(JSON.stringify({
              slug: resolved.full,
              v1: { version: v1, created_at: ver1.created_at, changelog: ver1.changelog },
              v2: { version: v2, created_at: ver2.created_at, changelog: ver2.changelog },
            }))
          } else {
            console.log(`  v${v1} (${new Date(ver1.created_at).toLocaleDateString('ko-KR')})`)
            if (ver1.changelog) console.log(`    ${ver1.changelog}`)
            console.log()
            console.log(`  v${v2} (${new Date(ver2.created_at).toLocaleDateString('ko-KR')})`)
            if (ver2.changelog) console.log(`    ${ver2.changelog}`)
            console.log()
            console.log(`\x1b[33m  버전별 패키지 다운로드 비교는 추후 지원 예정입니다.\x1b[0m`)
          }
        } finally {
          removeTempDir(tempDir1)
          removeTempDir(tempDir2)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'DIFF_FAILED', message }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
