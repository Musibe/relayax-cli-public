import os from 'os'
import path from 'path'
import { Command } from 'commander'
import {
  loadInstalled,
  saveInstalled,
  loadGlobalInstalled,
  saveGlobalInstalled,
} from '../lib/config.js'
import { uninstallAgent, cleanEmptyParents, removeSymlinks } from '../lib/installer.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'
import { AI_TOOLS } from '../lib/ai-tools.js'
import { resolveProjectPath } from '../lib/paths.js'

/**
 * deployed_files에서 에이전트 설정 디렉토리(skillsDir) 기반 boundary를 추론한다.
 * 예: deployed_files에 '~/.cursor/commands/relay/x.md'가 있으면 boundary는 basePath/.cursor
 */
function inferBoundary(deployedFiles: string[], basePath: string): string {
  const skillsDirs = AI_TOOLS.map((t) => t.skillsDir)
  for (const f of deployedFiles) {
    for (const sd of skillsDirs) {
      const prefix = path.join(basePath, sd)
      if (f.startsWith(prefix)) {
        return prefix
      }
    }
  }
  // fallback: 첫 번째 파일의 상위 디렉토리 중 basePath 직속 디렉토리
  return path.join(basePath, '.claude')
}

export function registerUninstall(program: Command): void {
  program
    .command('uninstall <slug>')
    .description('에이전트 제거')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .action((slugInput: string, _opts: { project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const localInstalled = loadInstalled()
      const globalInstalled = loadGlobalInstalled()

      // Resolve slug — support short names like "cardnews-agent"
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
        const removed = uninstallAgent(localEntry.files)
        totalRemoved += removed.length

        // Remove deployed symlinks (new)
        if (localEntry.deployed_symlinks && localEntry.deployed_symlinks.length > 0) {
          const symlinkRemoved = removeSymlinks(localEntry.deployed_symlinks)
          totalRemoved += symlinkRemoved.length
          const boundary = inferBoundary(localEntry.deployed_symlinks, resolveProjectPath(_opts.project))
          for (const f of symlinkRemoved) {
            cleanEmptyParents(f, boundary)
          }
        }

        // Remove deployed files (legacy)
        if (localEntry.deployed_files && localEntry.deployed_files.length > 0) {
          const deployedRemoved = uninstallAgent(localEntry.deployed_files)
          totalRemoved += deployedRemoved.length
          const boundary = inferBoundary(localEntry.deployed_files, resolveProjectPath(_opts.project))
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
          const removed = uninstallAgent(globalEntry.files)
          totalRemoved += removed.length
        }

        // Remove deployed symlinks (new)
        if (globalEntry.deployed_symlinks && globalEntry.deployed_symlinks.length > 0) {
          const symlinkRemoved = removeSymlinks(globalEntry.deployed_symlinks)
          totalRemoved += symlinkRemoved.length
          const boundary = inferBoundary(globalEntry.deployed_symlinks, os.homedir())
          for (const f of symlinkRemoved) {
            cleanEmptyParents(f, boundary)
          }
        }

        // Remove globally deployed files (legacy)
        if (globalEntry.deployed_files && globalEntry.deployed_files.length > 0) {
          const deployedRemoved = uninstallAgent(globalEntry.deployed_files)
          totalRemoved += deployedRemoved.length
          const boundary = inferBoundary(globalEntry.deployed_files, os.homedir())
          for (const f of deployedRemoved) {
            cleanEmptyParents(f, boundary)
          }
        }

        delete globalInstalled[slug]
        saveGlobalInstalled(globalInstalled)
      }

      const result = {
        status: 'ok',
        agent: slug,
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
