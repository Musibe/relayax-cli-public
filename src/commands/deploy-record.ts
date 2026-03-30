import path from 'path'
import { Command } from 'commander'
import {
  loadInstalled,
  saveInstalled,
  loadGlobalInstalled,
  saveGlobalInstalled,
} from '../lib/config.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'

export function registerDeployRecord(program: Command): void {
  program
    .command('deploy-record <slug>')
    .description('에이전트가 배치한 파일 정보를 installed.json에 기록합니다')
    .requiredOption('--scope <scope>', '배치 범위 (global 또는 local)')
    .option('--files <paths...>', '배치된 파일 경로 목록')
    .action((slugInput: string, opts: { scope: string; files?: string[] }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const scope = opts.scope

      if (scope !== 'global' && scope !== 'local') {
        const msg = { error: 'INVALID_SCOPE', message: '--scope는 global 또는 local이어야 합니다.' }
        if (json) {
          console.error(JSON.stringify(msg))
        } else {
          console.error(`\x1b[31m오류:\x1b[0m ${msg.message}`)
        }
        process.exit(1)
      }

      const files = opts.files ?? []

      // Resolve absolute paths
      const resolvedFiles = files.map((f) =>
        f.startsWith('/') || f.startsWith('~')
          ? f
          : path.resolve(f)
      )

      // Find the team in the appropriate registry
      const localRegistry = loadInstalled()
      const globalRegistry = loadGlobalInstalled()

      // Resolve slug — check both registries for short name match
      let slug: string
      if (isScopedSlug(slugInput)) {
        slug = slugInput
      } else {
        const allKeys = [...Object.keys(localRegistry), ...Object.keys(globalRegistry)]
        const match = allKeys.find((key) => {
          const parsed = parseSlug(key)
          return parsed && parsed.name === slugInput
        })
        slug = match ?? slugInput
      }

      // Check if team exists in either registry
      const entry = localRegistry[slug] ?? globalRegistry[slug]
      if (!entry) {
        const msg = { error: 'NOT_INSTALLED', message: `'${slugInput}'는 설치되어 있지 않습니다.` }
        if (json) {
          console.error(JSON.stringify(msg))
        } else {
          console.error(`\x1b[31m오류:\x1b[0m ${msg.message}`)
        }
        process.exit(1)
      }

      // Update deploy info
      entry.deploy_scope = scope as 'global' | 'local'
      entry.deployed_files = resolvedFiles

      // Save to the correct registry based on scope
      if (scope === 'global') {
        globalRegistry[slug] = entry
        saveGlobalInstalled(globalRegistry)
        // Also update local registry if entry exists there
        if (localRegistry[slug]) {
          localRegistry[slug] = entry
          saveInstalled(localRegistry)
        }
      } else {
        localRegistry[slug] = entry
        saveInstalled(localRegistry)
      }

      const result = {
        status: 'ok',
        slug,
        deploy_scope: scope,
        deployed_files: resolvedFiles.length,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        const scopeLabel = scope === 'global' ? '글로벌' : '로컬'
        console.log(`\x1b[32m✓ ${slug} 배치 정보 기록 완료\x1b[0m (${scopeLabel}, ${resolvedFiles.length}개 파일)`)
      }
    })
}
