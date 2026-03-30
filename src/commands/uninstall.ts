import os from 'os'
import path from 'path'
import { Command } from 'commander'
import {
  loadInstalled,
  saveInstalled,
  loadGlobalInstalled,
  saveGlobalInstalled,
} from '../lib/config.js'
import { uninstallTeam, cleanEmptyParents } from '../lib/installer.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'

export function registerUninstall(program: Command): void {
  program
    .command('uninstall <slug>')
    .description('에이전트 팀 제거')
    .action((slugInput: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const localInstalled = loadInstalled()
      const globalInstalled = loadGlobalInstalled()

      // Resolve slug — support short names like "cardnews-team"
      let slug: string
      if (isScopedSlug(slugInput)) {
        slug = slugInput
      } else {
        const allKeys = [...Object.keys(localInstalled), ...Object.keys(globalInstalled)]
        const match = allKeys.find((key) => {
          const parsed = parseSlug(key)
          return parsed && parsed.name === slugInput
        })
        slug = match ?? slugInput
      }

      const localEntry = localInstalled[slug]
      const globalEntry = globalInstalled[slug]

      if (!localEntry && !globalEntry) {
        const msg = { error: 'NOT_INSTALLED', message: `'${slugInput}'는 설치되어 있지 않습니다.` }
        if (json) {
          console.error(JSON.stringify(msg))
        } else {
          console.error(`\x1b[31m오류:\x1b[0m ${msg.message}`)
        }
        process.exit(1)
      }

      let totalRemoved = 0

      // Remove from local registry
      if (localEntry) {
        const removed = uninstallTeam(localEntry.files)
        totalRemoved += removed.length

        // Remove deployed files
        if (localEntry.deployed_files && localEntry.deployed_files.length > 0) {
          const deployedRemoved = uninstallTeam(localEntry.deployed_files)
          totalRemoved += deployedRemoved.length
          // Clean empty parent directories
          const boundary = path.join(process.cwd(), '.claude')
          for (const f of deployedRemoved) {
            cleanEmptyParents(f, boundary)
          }
        }

        delete localInstalled[slug]
        saveInstalled(localInstalled)
      }

      // Remove from global registry
      if (globalEntry) {
        // Only remove files if not already handled by local entry
        if (!localEntry) {
          const removed = uninstallTeam(globalEntry.files)
          totalRemoved += removed.length
        }

        // Remove globally deployed files
        if (globalEntry.deployed_files && globalEntry.deployed_files.length > 0) {
          const deployedRemoved = uninstallTeam(globalEntry.deployed_files)
          totalRemoved += deployedRemoved.length
          // Clean empty parent directories
          const boundary = path.join(os.homedir(), '.claude')
          for (const f of deployedRemoved) {
            cleanEmptyParents(f, boundary)
          }
        }

        delete globalInstalled[slug]
        saveGlobalInstalled(globalInstalled)
      }

      const result = {
        status: 'ok',
        team: slug,
        files_removed: totalRemoved,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        console.log(`\n\x1b[32m✓ ${slug} 제거 완료\x1b[0m`)
        console.log(`  삭제된 파일: ${totalRemoved}개`)
      }
    })
}
