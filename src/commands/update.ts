import fs from 'fs'
import os from 'os'
import path from 'path'
import { Command } from 'commander'
import { fetchAgentInfo, fetchAgentVersions, reportInstall } from '../lib/api.js'
import { makeTempDir, removeTempDir, clonePackage } from '../lib/storage.js'
import { checkGitInstalled, gitFetch, gitCheckout, gitLatestTag } from '../lib/git-operations.js'
import { uninstallAgent, deploySymlinks, removeSymlinks, checkRequires, printRequiresCheck } from '../lib/installer.js'
import { loadInstalled, saveInstalled, loadGlobalInstalled, saveGlobalInstalled, getValidToken } from '../lib/config.js'
import { resolveSlug, isScopedSlug, parseSlug } from '../lib/slug.js'
import { injectPreambleToAgent } from '../lib/preamble.js'
import { resolveProjectPath } from '../lib/paths.js'

export function registerUpdate(program: Command): void {
  program
    .command('update <slug>')
    .description('설치된 에이전트를 최신 버전으로 업데이트합니다')
    .option('--path <install_path>', '설치 경로 지정 (기본: ./.claude)')
    .option('--code <code>', '초대 코드 (비공개 에이전트 업데이트 시 필요)')
    .action(async (slugInput: string, opts: { path?: string; code?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const tempDir = makeTempDir()

      const projectPath = resolveProjectPath(opts.path)

      try {
        // Resolve scoped slug
        const localInstalled = loadInstalled()
        const globalInstalled = loadGlobalInstalled()
        let slug: string

        if (isScopedSlug(slugInput)) {
          slug = slugInput
        } else {
          const parsed = await resolveSlug(slugInput)
          slug = parsed.full
        }

        // Find current entry (check both registries)
        const currentEntry = localInstalled[slug] ?? globalInstalled[slug]
        const currentVersion = currentEntry?.version ?? null
        const currentScope: 'global' | 'local' = globalInstalled[slug] ? 'global'
          : currentEntry?.deploy_scope ?? 'global'

        // Fetch latest agent metadata
        const agent = await fetchAgentInfo(slug)
        const latestVersion = agent.version

        if (currentVersion && currentVersion === latestVersion) {
          if (json) {
            console.log(JSON.stringify({ status: 'up-to-date', slug, version: latestVersion }))
          } else {
            console.log(`이미 최신 버전입니다  (${slug} v${latestVersion})`)
          }
          return
        }

        // Visibility check
        const visibility = agent.visibility ?? 'public'
        if (visibility === 'internal') {
          const token = await getValidToken()
          if (!token) {
            console.error('이 에이전트는 Org 멤버만 업데이트할 수 있습니다. `relay login`을 먼저 실행하세요.')
            process.exit(1)
          }
        }

        // Clean up old symlinks (new) and deployed_files (legacy migration)
        if (currentEntry?.deployed_symlinks && currentEntry.deployed_symlinks.length > 0) {
          removeSymlinks(currentEntry.deployed_symlinks)
        }
        if (currentEntry?.deployed_files && currentEntry.deployed_files.length > 0) {
          uninstallAgent(currentEntry.deployed_files)
        }

        // Determine agent directory
        const parsedSlug = parseSlug(slug)
        const owner = parsedSlug?.owner ?? 'unknown'
        const name = parsedSlug?.name ?? slug
        const agentDir = currentScope === 'global'
          ? path.join(os.homedir(), '.relay', 'agents', owner, name)
          : path.join(projectPath, '.relay', 'agents', owner, name)

        // Download & extract: prefer git, fallback to tar.gz
        if (agent.git_url && fs.existsSync(path.join(agentDir, '.git'))) {
          // Existing git clone — fetch + checkout latest tag
          checkGitInstalled()
          gitFetch(agentDir)
          const latestTag = gitLatestTag(agentDir)
          if (latestTag) {
            gitCheckout(agentDir, latestTag)
          }
        } else if (agent.git_url) {
          // No existing clone — fresh git clone
          checkGitInstalled()
          await clonePackage(agent.git_url, agentDir)
        } else {
          throw new Error('이 에이전트는 재설치가 필요합니다. relay install로 다시 설치하세요.')
        }

        // Inject preamble
        injectPreambleToAgent(agentDir, slug)

        // Deploy symlinks (always — handles migration from legacy deployed_files)
        const deploy = await deploySymlinks(agentDir, currentScope, projectPath)

        // Update installed.json
        const installRecord = {
          agent_id: agent.id,
          version: latestVersion,
          installed_at: new Date().toISOString(),
          files: [agentDir],
          deploy_scope: currentScope,
          deployed_symlinks: deploy.symlinks,
        }
        if (currentScope === 'global') {
          globalInstalled[slug] = installRecord
          saveGlobalInstalled(globalInstalled)
          // Clean up local entry if migrating
          if (localInstalled[slug]) {
            delete localInstalled[slug]
            saveInstalled(localInstalled)
          }
        } else {
          localInstalled[slug] = installRecord
          saveInstalled(localInstalled)
        }

        // Report
        await reportInstall(agent.id, slug, latestVersion)

        const result = {
          status: 'updated',
          slug,
          from_version: currentVersion,
          version: latestVersion,
          scope: currentScope,
          symlinks: deploy.symlinks.length,
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          const fromLabel = currentVersion ? `v${currentVersion} → ` : ''
          console.log(`\n\x1b[32m✓ ${agent.name} ${fromLabel}v${latestVersion} 업데이트 완료\x1b[0m`)
          console.log(`  위치: \x1b[36m${agentDir}\x1b[0m`)
          console.log(`  symlink: ${deploy.symlinks.length}개`)

          // Show changelog
          try {
            const versions = await fetchAgentVersions(slug)
            const thisVersion = versions.find((v) => v.version === latestVersion)
            if (thisVersion?.changelog) {
              console.log(`\n  \x1b[90m── Changelog ──────────────────────────────\x1b[0m`)
              for (const line of thisVersion.changelog.split('\n').slice(0, 5)) {
                console.log(`  ${line}`)
              }
              console.log(`  \x1b[90m───────────────────────────────────────────\x1b[0m`)
            }
          } catch {
            // Non-critical
          }

          // Requires check
          const requiresResults = checkRequires(agentDir)
          printRequiresCheck(requiresResults)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(JSON.stringify({ error: 'UPDATE_FAILED', message, fix: 'npm update -g relayax-cli로 수동 업데이트하세요.' }))
        process.exit(1)
      } finally {
        removeTempDir(tempDir)
      }
    })
}
