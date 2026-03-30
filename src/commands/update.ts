import { Command } from 'commander'
import { fetchAgentInfo, fetchAgentVersions, reportInstall } from '../lib/api.js'
import { downloadPackage, extractPackage, makeTempDir, removeTempDir } from '../lib/storage.js'
import { installAgent } from '../lib/installer.js'
import { getInstallPath, loadInstalled, saveInstalled, getValidToken } from '../lib/config.js'
import { resolveSlug, isScopedSlug } from '../lib/slug.js'
import { injectPreambleToAgent } from '../lib/preamble.js'

export function registerUpdate(program: Command): void {
  program
    .command('update <slug>')
    .description('설치된 에이전트를 최신 버전으로 업데이트합니다')
    .option('--path <install_path>', '설치 경로 지정 (기본: ./.claude)')
    .option('--code <code>', '초대 코드 (비공개 에이전트 업데이트 시 필요)')
    .action(async (slugInput: string, opts: { path?: string; code?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const installPath = getInstallPath(opts.path)
      const tempDir = makeTempDir()

      try {
        // Resolve scoped slug (try installed.json first for offline, then server)
        const installed = loadInstalled()
        let slug: string

        if (isScopedSlug(slugInput)) {
          slug = slugInput
        } else {
          const parsed = await resolveSlug(slugInput)
          slug = parsed.full
        }

        // Check installed.json for current version
        const currentEntry = installed[slug]
        const currentVersion = currentEntry?.version ?? null

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

        // Download package
        const tarPath = await downloadPackage(agent.package_url, tempDir)

        // Extract
        const extractDir = `${tempDir}/extracted`
        await extractPackage(tarPath, extractDir)

        // Inject preamble (update check) before copying
        injectPreambleToAgent(extractDir, slug)

        // Copy files to install_path
        const files = installAgent(extractDir, installPath)

        // Preserve deploy info but clear deployed_files (agent needs to re-deploy)
        const previousDeployScope = currentEntry?.deploy_scope
        const hadDeployedFiles = (currentEntry?.deployed_files?.length ?? 0) > 0

        // Update installed.json with new version
        installed[slug] = {
          agent_id: agent.id,
          version: latestVersion,
          installed_at: new Date().toISOString(),
          files,
          // Keep deploy_scope so agent knows where to re-deploy
          ...(previousDeployScope ? { deploy_scope: previousDeployScope } : {}),
          // Clear deployed_files — agent must re-deploy and call deploy-record
        }
        saveInstalled(installed)

        // Report install (non-blocking, agent_id 기반)
        await reportInstall(agent.id, slug, latestVersion)

        const result = {
          status: 'updated',
          slug,
          from_version: currentVersion,
          version: latestVersion,
          files_installed: files.length,
          install_path: installPath,
          ...(hadDeployedFiles ? { needs_redeploy: true, previous_deploy_scope: previousDeployScope } : {}),
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          const fromLabel = currentVersion ? `v${currentVersion} → ` : ''
          console.log(`\n\x1b[32m✓ ${agent.name} ${fromLabel}v${latestVersion} 업데이트 완료\x1b[0m`)
          console.log(`  설치 위치: \x1b[36m${installPath}\x1b[0m`)
          console.log(`  파일 수:   ${files.length}개`)

          // Show changelog for this version
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
            // Non-critical: skip changelog display
          }

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
