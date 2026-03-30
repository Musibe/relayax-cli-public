import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { detectAgentCLIs } from '../lib/ai-tools.js'
import { resolveProjectPath } from '../lib/paths.js'
import { getValidToken, API_URL } from '../lib/config.js'
import {
  USER_COMMANDS,
  BUILDER_COMMANDS,
  getGlobalCommandPath,
} from '../lib/command-adapter.js'

interface StatusResult {
  login: { authenticated: boolean; username?: string }
  agent: { detected: string | null; global_commands: boolean; local_commands: boolean }
  project: { is_agent: boolean; name?: string; slug?: string; version?: string } | null
}

async function resolveUsername(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return undefined
    const body = await res.json() as { username?: string }
    return body.username
  } catch {
    return undefined
  }
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('현재 relay 환경 상태를 표시합니다')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .action(async (opts: { project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)

      // 1. 로그인 상태
      const token = await getValidToken()
      let username: string | undefined
      if (token) {
        username = await resolveUsername(token)
      }

      // 2. 에이전트 감지
      const detected = detectAgentCLIs(projectPath)
      const primaryAgent = detected.length > 0 ? detected[0] : null

      // 글로벌 커맨드 상태
      const hasGlobal = USER_COMMANDS.every((cmd) =>
        fs.existsSync(getGlobalCommandPath(cmd.id))
      )

      // 로컬 Builder 커맨드 상태
      let hasLocal = false
      if (primaryAgent) {
        const localDir = path.join(projectPath, primaryAgent.skillsDir, 'commands', 'relay')
        hasLocal = BUILDER_COMMANDS.some((cmd) =>
          fs.existsSync(path.join(localDir, `${cmd.id}.md`))
        )
      }

      // 3. 에이전트 프로젝트 정보
      const relayYamlPath = path.join(projectPath, '.relay', 'relay.yaml')
      let project: StatusResult['project'] = null

      if (fs.existsSync(relayYamlPath)) {
        try {
          const yaml = await import('js-yaml')
          const content = fs.readFileSync(relayYamlPath, 'utf-8')
          const raw = yaml.load(content) as Record<string, unknown>
          project = {
            is_agent: true,
            name: String(raw.name ?? ''),
            slug: String(raw.slug ?? ''),
            version: String(raw.version ?? ''),
          }
        } catch {
          project = { is_agent: true }
        }
      } else {
        project = { is_agent: false }
      }

      // 4. 출력
      if (json) {
        const result: StatusResult = {
          login: { authenticated: !!token, username },
          agent: {
            detected: primaryAgent?.name ?? null,
            global_commands: hasGlobal,
            local_commands: hasLocal,
          },
          project,
        }
        console.log(JSON.stringify(result))
      } else {
        console.log('')

        // 로그인
        if (token && username) {
          console.log(`  \x1b[32m✓\x1b[0m 로그인: \x1b[36m${username}\x1b[0m`)
        } else if (token) {
          console.log(`  \x1b[32m✓\x1b[0m 로그인: 인증됨`)
        } else {
          console.log(`  \x1b[31m✗\x1b[0m 로그인: 미인증 (\x1b[33mrelay login\x1b[0m으로 로그인)`)
        }

        // 에이전트
        if (primaryAgent) {
          const globalLabel = hasGlobal ? '\x1b[32m글로벌 ✓\x1b[0m' : '\x1b[31m글로벌 ✗\x1b[0m'
          const localLabel = hasLocal ? '\x1b[32m로컬 ✓\x1b[0m' : '\x1b[2m로컬 —\x1b[0m'
          console.log(`  \x1b[32m✓\x1b[0m 에이전트: \x1b[36m${primaryAgent.name}\x1b[0m (${globalLabel} ${localLabel})`)
        } else {
          console.log(`  \x1b[31m✗\x1b[0m 에이전트: 감지 안 됨`)
        }

        // 에이전트 프로젝트
        if (project?.is_agent && project.name) {
          console.log(`  \x1b[32m✓\x1b[0m 현재 에이전트: \x1b[36m${project.name}\x1b[0m v${project.version}`)
        } else {
          console.log(`  \x1b[2m—\x1b[0m 현재 프로젝트: 에이전트 아님`)
        }

        console.log('')
      }
    })
}
