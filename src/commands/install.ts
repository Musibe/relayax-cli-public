import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { fetchTeamInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import type { TeamRegistryInfo } from '../types.js'
import { downloadPackage, extractPackage, makeTempDir, removeTempDir } from '../lib/storage.js'
import { loadInstalled, saveInstalled, getValidToken } from '../lib/config.js'
import { resolveSlug } from '../lib/slug.js'
import { formatContactParts } from '../lib/contact-format.js'
import { injectPreambleToTeam } from '../lib/preamble.js'
import { hasGlobalUserCommands, installGlobalUserCommands } from './init.js'

export function registerInstall(program: Command): void {
  program
    .command('install <slug>')
    .description('에이전트 팀 패키지를 .relay/teams/에 다운로드합니다')
    .option('--join-code <code>', '초대 코드 (Organization 팀 설치 시 자동 가입)')
    .action(async (slugInput: string, _opts: { joinCode?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = process.cwd()
      const tempDir = makeTempDir()

      // Auto-init: 글로벌 커맨드가 없으면 자동 설치
      if (!hasGlobalUserCommands()) {
        if (!json) {
          console.error('\x1b[33m⚙ 글로벌 커맨드를 자동 설치합니다...\x1b[0m')
        }
        installGlobalUserCommands()
      }

      try {
        // Resolve scoped slug and fetch team metadata
        let team: TeamRegistryInfo | undefined
        let slug: string
        let parsed: { owner: string; name: string; full: string }

        // Extract version from @owner/team@version syntax
        // Extract version from @owner/team@version syntax (e.g. acme/writer@1.2.0)
        // Version-specific install is not yet supported by the registry API;
        // the match is kept for future use when per-version package URLs are available.
        const versionMatch = slugInput.match(/^(.+)@(\d+\.\d+\.\d+.*)$/)
        const actualSlugInput = versionMatch ? versionMatch[1] : slugInput

        parsed = await resolveSlug(actualSlugInput)
        slug = parsed.full

        try {
          team = await fetchTeamInfo(slug)
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

            // Gated team: show purchase info + relay access hint
            if (errorVisibility === 'gated' || purchaseInfo) {
              if (json) {
                console.error(JSON.stringify({
                  error: 'GATED_ACCESS_REQUIRED',
                  message: '이 팀은 접근 권한이 필요합니다.',
                  slug,
                  purchase_info: purchaseInfo ?? null,
                  fix: '접근 링크 코드가 있으면: relay access <slug> --code <코드>',
                }))
              } else {
                console.error('\x1b[31m이 팀은 접근 권한이 필요합니다.\x1b[0m')
                if (purchaseInfo?.message) {
                  console.error(`\n  \x1b[36m${purchaseInfo.message}\x1b[0m`)
                }
                if (purchaseInfo?.url) {
                  console.error(`  \x1b[36m${purchaseInfo.url}\x1b[0m`)
                }
                console.error(`\n\x1b[33m접근 링크 코드가 있으면: relay access ${slugInput} --code <코드>\x1b[0m`)
              }
              process.exit(1)
            }

            if (membershipStatus === 'member') {
              // Member but no access to this specific team
              if (json) {
                console.error(JSON.stringify({
                  error: 'NO_ACCESS',
                  message: '이 팀에 대한 접근 권한이 없습니다.',
                  slug,
                  fix: '이 팀의 접근 링크 코드가 있으면 `relay access ' + slugInput + ' --code <코드>`로 접근 권한을 얻으세요. 없으면 팀 제작자에게 문의하세요.',
                }))
              } else {
                console.error('\x1b[31m이 팀에 대한 접근 권한이 없습니다.\x1b[0m')
              }
              process.exit(1)
            } else {
              if (json) {
                console.error(JSON.stringify({
                  error: 'ACCESS_REQUIRED',
                  message: '이 팀은 접근 권한이 필요합니다.',
                  slug,
                  fix: '초대 코드가 있으면 `relay join <org-slug> --code <코드>`로 가입하세요.',
                }))
              } else {
                console.error('\x1b[31m이 팀은 접근 권한이 필요합니다.\x1b[0m')
                console.error('\x1b[33m초대 코드가 있으면 `relay join <org-slug> --code <코드>`로 가입하세요.\x1b[0m')
              }
              process.exit(1)
            }
          } else {
            throw fetchErr
          }
        }

        if (!team) throw new Error('팀 정보를 가져오지 못했습니다.')

        const teamDir = path.join(projectPath, '.relay', 'teams', parsed.owner, parsed.name)

        // 2. Visibility check + auto-login
        const visibility = team.visibility ?? 'public'
        if (visibility === 'private') {
          let token = await getValidToken()
          if (!token) {
            const isTTY = Boolean(process.stdin.isTTY)
            if (isTTY && !json) {
              // Auto-login: TTY 환경에서 자동으로 login 플로우 트리거
              console.error('\x1b[33m⚙ 이 팀은 로그인이 필요합니다. 로그인을 시작합니다...\x1b[0m')
              const { runLogin } = await import('./login.js')
              await runLogin()
              token = await getValidToken()
            }
            if (!token) {
              if (json) {
                console.error(JSON.stringify({
                  error: 'LOGIN_REQUIRED',
                  visibility,
                  slug,
                  message: '이 팀은 로그인이 필요합니다. relay login을 먼저 실행하세요.',
                  fix: 'relay login 실행 후 재시도하세요.',
                }))
              } else {
                console.error('\x1b[31m이 팀은 로그인이 필요합니다. relay login 을 먼저 실행하세요.\x1b[0m')
              }
              process.exit(1)
            }
          }
        }

        // 3. Download package (retry once if signed URL expired)
        let tarPath: string
        try {
          tarPath = await downloadPackage(team.package_url, tempDir)
        } catch (dlErr) {
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          if (dlMsg.includes('403') || dlMsg.includes('expired')) {
            // Signed URL expired — re-fetch team info for new URL and retry
            if (!json) {
              console.error('\x1b[33m⚙ 다운로드 URL 만료, 재시도 중...\x1b[0m')
            }
            team = await fetchTeamInfo(slug)
            tarPath = await downloadPackage(team.package_url, tempDir)
          } else {
            throw dlErr
          }
        }

        // 4. Extract to .relay/teams/<slug>/
        if (fs.existsSync(teamDir)) {
          fs.rmSync(teamDir, { recursive: true, force: true })
        }
        fs.mkdirSync(teamDir, { recursive: true })
        await extractPackage(tarPath, teamDir)

        // 4.5. Inject preamble (update check) into SKILL.md and commands
        injectPreambleToTeam(teamDir, slug)

        // 5. Count extracted files
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
        const fileCount = countFiles(teamDir)

        // 6. Record in installed.json
        const installed = loadInstalled()
        installed[slug] = {
          team_id: team.id,
          version: team.version,
          installed_at: new Date().toISOString(),
          files: [teamDir],
        }
        saveInstalled(installed)

        // 7. Report install + usage ping (non-blocking, team_id 기반)
        await reportInstall(team.id, slug, team.version)
        sendUsagePing(team.id, slug, team.version)

        const result = {
          status: 'ok',
          team: team.name,
          slug,
          version: team.version,
          commands: team.commands,
          files: fileCount,
          install_path: teamDir,
          author: team.author ? {
            username: team.author.username,
            display_name: team.author.display_name ?? null,
            contact_links: team.author.contact_links ?? [],
          } : null,
          welcome: team.welcome ?? null,
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          const authorUsername = team.author?.username
          const authorDisplayName = team.author?.display_name ?? authorUsername ?? ''
          const authorSuffix = authorUsername ? `  \x1b[90mby @${authorUsername}\x1b[0m` : ''

          console.log(`\n\x1b[32m✓ ${team.name} 다운로드 완료\x1b[0m  v${team.version}${authorSuffix}`)
          console.log(`  위치: \x1b[36m${teamDir}\x1b[0m`)
          console.log(`  파일: ${fileCount}개`)
          if (team.commands.length > 0) {
            console.log('\n  포함된 커맨드:')
            for (const cmd of team.commands) {
              console.log(`    \x1b[33m/${cmd.name}\x1b[0m - ${cmd.description}`)
            }
          }

          // Builder business card
          const contactParts = formatContactParts(team.author?.contact_links)
          const hasCard = team.welcome || contactParts.length > 0 || authorUsername

          if (hasCard) {
            console.log(`\n  \x1b[90m┌─ ${authorDisplayName || authorUsername || '빌더'}의 명함 ${'─'.repeat(Math.max(0, 34 - (authorDisplayName || authorUsername || '빌더').length))}┐\x1b[0m`)
            if (team.welcome) {
              const truncated = team.welcome.length > 45 ? team.welcome.slice(0, 45) + '...' : team.welcome
              console.log(`  \x1b[90m│\x1b[0m  💬 "${truncated}"`)
            }
            if (contactParts.length > 0) {
              console.log(`  \x1b[90m│\x1b[0m  📇 ${contactParts.join('  ')}`)
            }
            if (authorUsername) {
              console.log(`  \x1b[90m│\x1b[0m  👤 relayax.com/@${authorUsername}`)
            }
            console.log(`  \x1b[90m└${'─'.repeat(44)}┘\x1b[0m`)
          }

          // Usage hint (type-aware)
          const teamType = team.type
          if (teamType === 'passive') {
            console.log(`\n\x1b[33m💡 자동 적용됩니다. 별도 실행 없이 동작합니다.\x1b[0m`)
          } else if (teamType === 'hybrid' && team.commands && team.commands.length > 0) {
            console.log(`\n\x1b[33m💡 자동 적용 + \x1b[1m/${team.commands[0].name}\x1b[0m\x1b[33m 으로 추가 기능을 사용할 수 있습니다.\x1b[0m`)
          } else if (team.commands && team.commands.length > 0) {
            console.log(`\n\x1b[33m💡 사용법: \x1b[1m/${team.commands[0].name}\x1b[0m`)
          } else {
            console.log(`\n\x1b[33m💡 설치 완료! AI 에이전트에서 사용할 수 있습니다.\x1b[0m`)
          }

          console.log('\n  \x1b[90m에이전트가 /relay-install로 환경을 구성합니다.\x1b[0m')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(JSON.stringify({ error: 'INSTALL_FAILED', message, fix: message }))
        process.exit(1)
      } finally {
        removeTempDir(tempDir)
      }
    })
}
