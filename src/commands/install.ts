import fs from 'fs'
import os from 'os'
import path from 'path'
import { Command } from 'commander'
import { fetchAgentInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import type { AgentRegistryInfo } from '../types.js'
import { makeTempDir, removeTempDir, clonePackage } from '../lib/storage.js'
import { checkGitInstalled, buildGitUrl } from '../lib/git-operations.js'
import { loadInstalled, saveInstalled, loadGlobalInstalled, saveGlobalInstalled, getValidToken, API_URL } from '../lib/config.js'
import { resolveSlug } from '../lib/slug.js'
import { injectPreambleToAgent } from '../lib/preamble.js'
import { hasGlobalUserCommands, installGlobalUserCommands } from './init.js'
import { resolveProjectPath } from '../lib/paths.js'
import { reportCliError } from '../lib/error-report.js'
import { trackCommand } from '../lib/step-tracker.js'
import { deploySymlinks, checkRequires, printRequiresCheck } from '../lib/installer.js'

export function registerInstall(program: Command): void {
  program
    .command('install <slug>')
    .description('에이전트 패키지를 .relay/agents/에 다운로드합니다')
    .option('--code <code>', '접근 코드 (비공개/내부 에이전트 설치 시)')
    .option('--global', '글로벌 설치 (홈 디렉토리)')
    .option('--local', '로컬 설치 (프로젝트 디렉토리)')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .action(async (slugInput: string, _opts: { code?: string; global?: boolean; local?: boolean; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(_opts.project)
      const tempDir = makeTempDir()

      // Auto-init: 글로벌 커맨드가 없으면 자동 설치
      if (!hasGlobalUserCommands()) {
        if (!json) {
          console.error('\x1b[33m⚙ 글로벌 커맨드를 자동 설치합니다...\x1b[0m')
        }
        installGlobalUserCommands()
      }

      trackCommand('install', { slug: slugInput })

      try {
        // Resolve scoped slug and fetch agent metadata
        let agent: AgentRegistryInfo | undefined
        let slug: string
        let parsed: { owner: string; name: string; full: string }

        // Extract version from @owner/agent@version syntax (e.g. acme/writer@1.2.0)
        // Version-specific install is not yet supported by the registry API;
        // the match is kept for future use when per-version package URLs are available.
        const versionMatch = slugInput.match(/^(.+)@(\d+\.\d+\.\d+.*)$/)
        const actualSlugInput = versionMatch ? versionMatch[1] : slugInput

        parsed = await resolveSlug(actualSlugInput)
        slug = parsed.full

        // Helper: ensure a valid token exists, triggering auto-login in TTY if needed.
        // Returns the token string or null if login failed / not available.
        async function ensureToken(): Promise<string | null> {
          let token = await getValidToken()
          if (!token) {
            const isTTY = Boolean(process.stdin.isTTY)
            if (isTTY && !json) {
              console.error('\x1b[33m⚙ 이 에이전트는 로그인이 필요합니다. 로그인을 시작합니다...\x1b[0m')
              const { runLogin } = await import('./login.js')
              await runLogin()
              token = await getValidToken()
            }
          }
          return token ?? null
        }

        // Pre-fetch auto-login: --code always requires auth.
        if (_opts.code) {
          const token = await ensureToken()
          if (!token) {
            if (json) {
              console.error(JSON.stringify({
                error: 'LOGIN_REQUIRED',
                slug,
                message: '이 에이전트는 로그인이 필요합니다. relay login을 먼저 실행하세요.',
                fix: 'relay login 실행 후 재시도하세요.',
              }))
            } else {
              console.error('\x1b[31m이 에이전트는 로그인이 필요합니다. relay login 을 먼저 실행하세요.\x1b[0m')
            }
            process.exit(1)
          }
        }

        try {
          agent = await fetchAgentInfo(slug)
        } catch (fetchErr) {
          const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          if (fetchMsg.includes('403')) {
            // Parse error body for membership_status, visibility, purchase_info
            let membershipStatus: string | undefined
            let errorVisibility: string | undefined
            let purchaseInfo: { message?: string; url?: string } | undefined
            try {
              const errBody = JSON.parse(fetchMsg.replace(/^.*?(\{)/, '{')) as Record<string, unknown>
              membershipStatus = typeof errBody.membership_status === 'string' ? errBody.membership_status : undefined
              errorVisibility = typeof errBody.visibility === 'string' ? errBody.visibility : undefined
              if (errBody.purchase_info && typeof errBody.purchase_info === 'object') {
                purchaseInfo = errBody.purchase_info as { message?: string; url?: string }
              }
            } catch { /* ignore parse errors */ }

            // --code provided → use unified access-codes API (handles both org join and agent grant)
            if (_opts.code) {
              if (!json) {
                console.error('\x1b[33m⚙ 접근 코드로 권한을 요청합니다...\x1b[0m')
              }
              const token = await getValidToken()
              if (!token) {
                if (json) {
                  console.error(JSON.stringify({
                    error: 'LOGIN_REQUIRED',
                    slug,
                    message: '이 에이전트는 로그인이 필요합니다. relay login을 먼저 실행하세요.',
                    fix: 'relay login 실행 후 재시도하세요.',
                  }))
                } else {
                  console.error('\x1b[31m이 에이전트는 로그인이 필요합니다. relay login 을 먼저 실행하세요.\x1b[0m')
                }
                process.exit(1)
              }
              const codeRes = await fetch(`${API_URL}/api/access-codes/${_opts.code}/use`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(10000),
              })
              if (!codeRes.ok) {
                const codeBody = (await codeRes.json().catch(() => ({}))) as { error?: string; message?: string }
                const codeErrCode = codeBody.error ?? String(codeRes.status)
                if (codeErrCode === 'INVALID_LINK') throw new Error('접근 코드가 유효하지 않거나 만료되었습니다.')
                throw new Error(codeBody.message ?? `접근 권한 요청 실패 (${codeRes.status})`)
              }
              agent = await fetchAgentInfo(slug)
            }
            // No code provided: show appropriate error messages
            else if (errorVisibility === 'private' || purchaseInfo) {
              // Private agent: show purchase info + relay access hint
              if (json) {
                console.error(JSON.stringify({
                  error: 'ACCESS_REQUIRED',
                  message: '이 에이전트는 접근 권한이 필요합니다.',
                  slug,
                  purchase_info: purchaseInfo ?? null,
                  fix: '접근 링크 코드가 있으면: relay install ' + slugInput + ' --code <코드>',
                }))
              } else {
                console.error('\x1b[31m이 에이전트는 접근 권한이 필요합니다.\x1b[0m')
                if (purchaseInfo?.message) {
                  console.error(`\n  \x1b[36m${purchaseInfo.message}\x1b[0m`)
                }
                if (purchaseInfo?.url) {
                  console.error(`  \x1b[36m${purchaseInfo.url}\x1b[0m`)
                }
                console.error(`\n\x1b[33m접근 링크 코드가 있으면: relay install ${slugInput} --code <코드>\x1b[0m`)
              }
              process.exit(1)
            } else if (membershipStatus === 'member') {
              // Member but no access to this specific agent
              if (json) {
                console.error(JSON.stringify({
                  error: 'NO_ACCESS',
                  message: '이 에이전트에 대한 접근 권한이 없습니다.',
                  slug,
                  fix: '이 에이전트의 접근 링크 코드가 있으면 `relay install ' + slugInput + ' --code <코드>`로 접근 권한을 얻으세요. 없으면 에이전트 제작자에게 문의하세요.',
                }))
              } else {
                console.error('\x1b[31m이 에이전트에 대한 접근 권한이 없습니다.\x1b[0m')
              }
              process.exit(1)
            } else {
              if (json) {
                console.error(JSON.stringify({
                  error: 'ACCESS_REQUIRED',
                  message: '이 에이전트는 접근 권한이 필요합니다.',
                  slug,
                  fix: '접근 코드가 있으면 `relay install ' + slugInput + ' --code <코드>`로 설치하세요.',
                }))
              } else {
                console.error('\x1b[31m이 에이전트는 접근 권한이 필요합니다.\x1b[0m')
                console.error('\x1b[33m접근 코드가 있으면 `relay install ' + slugInput + ' --code <코드>`로 설치하세요.\x1b[0m')
              }
              process.exit(1)
            }
          } else {
            throw fetchErr
          }
        }

        if (!agent) throw new Error('에이전트 정보를 가져오지 못했습니다.')

        // Re-bind as non-optional so TypeScript tracks the narrowing through nested scopes
        let resolvedAgent: AgentRegistryInfo = agent

        // Scope 자동결정: --global/--local 플래그 > recommended_scope > agent_type 기반
        const scope: 'global' | 'local' = _opts.global ? 'global'
          : _opts.local ? 'local'
          : resolvedAgent.recommended_scope ?? (resolvedAgent.type === 'passive' ? 'local' : 'global')

        const agentDir = scope === 'global'
          ? path.join(os.homedir(), '.relay', 'agents', parsed.owner, parsed.name)
          : path.join(projectPath, '.relay', 'agents', parsed.owner, parsed.name)

        // 2. 로그인 필수 (git clone에 relay token 필요)
        const token = await ensureToken()
        if (!token) {
          if (json) {
            console.error(JSON.stringify({
              error: 'LOGIN_REQUIRED',
              slug,
              message: '로그인이 필요합니다. relay login을 먼저 실행하세요.',
              fix: 'relay login 실행 후 재시도하세요.',
            }))
          } else {
            console.error('\x1b[31m로그인이 필요합니다. relay login 을 먼저 실행하세요.\x1b[0m')
          }
          process.exit(1)
        }

        // 3. Download package via git clone
        const requestedVersion = versionMatch ? versionMatch[2] : undefined
        if (!resolvedAgent.git_url) {
          const errMsg = '이 에이전트는 재publish가 필요합니다. 빌더에게 문의하세요.'
          if (json) {
            console.log(JSON.stringify({ error: 'NO_GIT_URL', message: errMsg }))
          } else {
            console.error(`\x1b[31m✖ ${errMsg}\x1b[0m`)
          }
          process.exit(1)
        }

        checkGitInstalled()
        const gitUrl = buildGitUrl(resolvedAgent.git_url, { token })
        await clonePackage(gitUrl, agentDir, requestedVersion)

        // Verify clone has actual files (not just .git)
        const clonedEntries = fs.readdirSync(agentDir).filter((f) => f !== '.git')
        if (clonedEntries.length === 0) {
          fs.rmSync(agentDir, { recursive: true, force: true })
          const errMsg = '에이전트 패키지가 비어있습니다. 빌더에게 재publish를 요청하세요.'
          if (json) {
            console.log(JSON.stringify({ error: 'EMPTY_PACKAGE', message: errMsg }))
          } else {
            console.error(`\x1b[31m✖ ${errMsg}\x1b[0m`)
          }
          process.exit(1)
        }

        // 4.5. Inject preamble (update check) into SKILL.md and commands
        injectPreambleToAgent(agentDir, slug)

        // 5. Deploy symlinks to detected AI tool directories
        const deploy = await deploySymlinks(agentDir, scope, projectPath)
        for (const w of deploy.warnings) {
          if (!json) console.error(`\x1b[33m${w}\x1b[0m`)
        }

        // 6. Count extracted files
        function countFiles(dir: string): number {
          let count = 0
          if (!fs.existsSync(dir)) return 0
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              count += countFiles(path.join(dir, entry.name))
            } else {
              count++
            }
          }
          return count
        }
        const fileCount = countFiles(agentDir)

        // 7. Record in installed.json (scope-aware)
        const installRecord = {
          agent_id: resolvedAgent.id,
          version: resolvedAgent.version,
          installed_at: new Date().toISOString(),
          files: [agentDir],
          deploy_scope: scope,
          deployed_symlinks: deploy.symlinks,
        }
        if (scope === 'global') {
          const globalInstalled = loadGlobalInstalled()
          globalInstalled[slug] = installRecord
          saveGlobalInstalled(globalInstalled)
        } else {
          const installed = loadInstalled()
          installed[slug] = installRecord
          saveInstalled(installed)
        }

        // 8. Report install + usage ping (non-blocking, agent_id 기반)
        await reportInstall(resolvedAgent.id, slug, resolvedAgent.version)
        sendUsagePing(resolvedAgent.id, slug, resolvedAgent.version)

        const result = {
          status: 'ok',
          agent: resolvedAgent.name,
          slug,
          version: resolvedAgent.version,
          commands: resolvedAgent.commands,
          files: fileCount,
          install_path: agentDir,
          scope,
          symlinks: deploy.symlinks,
          author: resolvedAgent.author ? {
            username: resolvedAgent.author.username,
            display_name: resolvedAgent.author.display_name ?? null,
            contact_links: resolvedAgent.author.contact_links ?? [],
          } : null,
          welcome: resolvedAgent.welcome ?? null,
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          const authorUsername = resolvedAgent.author?.username
          const authorSuffix = authorUsername ? `  \x1b[90mby @${authorUsername}\x1b[0m` : ''
          const scopeLabel = scope === 'global' ? '글로벌' : '로컬'

          console.log(`\n\x1b[32m✓ ${resolvedAgent.name} 설치 완료\x1b[0m  v${resolvedAgent.version}${authorSuffix}`)
          console.log(`  위치: \x1b[36m${agentDir}\x1b[0m`)
          console.log(`  범위: ${scopeLabel}`)
          console.log(`  파일: ${fileCount}개, symlink: ${deploy.symlinks.length}개`)
          if (resolvedAgent.commands.length > 0) {
            console.log('\n  포함된 커맨드:')
            for (const cmd of resolvedAgent.commands) {
              console.log(`    \x1b[33m/${cmd.name}\x1b[0m - ${cmd.description}`)
            }
          }

          // Usage hint (type-aware)
          const agentType = resolvedAgent.type
          if (agentType === 'passive') {
            console.log(`\n\x1b[33m💡 자동 적용됩니다. 별도 실행 없이 동작합니다.\x1b[0m`)
          } else if (agentType === 'hybrid' && resolvedAgent.commands && resolvedAgent.commands.length > 0) {
            console.log(`\n\x1b[33m💡 자동 적용 + \x1b[1m/${resolvedAgent.commands[0].name}\x1b[0m\x1b[33m 으로 추가 기능을 사용할 수 있습니다.\x1b[0m`)
          } else if (resolvedAgent.commands && resolvedAgent.commands.length > 0) {
            console.log(`\n\x1b[33m💡 사용법: \x1b[1m/${resolvedAgent.commands[0].name}\x1b[0m`)
          } else {
            console.log(`\n\x1b[33m💡 설치 완료! AI 에이전트에서 사용할 수 있습니다.\x1b[0m`)
          }

          // Requires check
          const requiresResults = checkRequires(agentDir)
          printRequiresCheck(requiresResults)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportCliError('install', 'INSTALL_FAILED', message)
        console.error(JSON.stringify({ error: 'INSTALL_FAILED', message, fix: message }))
        process.exit(1)
      } finally {
        removeTempDir(tempDir)
      }
    })
}
