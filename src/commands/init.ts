import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { detectAgentCLIs, detectGlobalCLIs, AI_TOOLS } from '../lib/ai-tools.js'
import {
  createAdapter,
  USER_COMMANDS,
  BUILDER_COMMANDS,
  formatCommandFile,
  getGlobalCommandDir,
  getGlobalCommandPath,
  getGlobalCommandDirForTool,
  getGlobalCommandPathForTool,
} from '../lib/command-adapter.js'
import { loadInstalled, saveInstalled } from '../lib/config.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

const VALID_TEAM_DIRS = ['skills', 'agents', 'rules', 'commands'] as const

function resolveTools(toolsArg: string): string[] {
  const raw = toolsArg.trim().toLowerCase()

  if (raw === 'all') {
    return AI_TOOLS.map((t) => t.value)
  }

  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean)
  const valid = new Set(AI_TOOLS.map((t) => t.value))
  const invalid = tokens.filter((t) => !valid.has(t))

  if (invalid.length > 0) {
    throw new Error(`알 수 없는 도구: ${invalid.join(', ')}\n사용 가능: ${[...valid].join(', ')}`)
  }

  return tokens
}

function showWelcome(): void {
  const lines = [
    '',
    '  \x1b[33m⚡\x1b[0m \x1b[1mrelay\x1b[0m — Agent Team Marketplace',
    '',
    '  에이전트 CLI에 relay 커맨드를 연결합니다.',
    '',
    '  \x1b[2mUser 커맨드 (글로벌)\x1b[0m',
    '  /relay-install     팀 탐색 & 설치',
    '  /relay-status      설치 현황 & Space',
    '  /relay-uninstall   팀 삭제',
    '',
  ]
  console.log(lines.join('\n'))
}

async function selectToolsInteractively(detectedIds: Set<string>): Promise<string[]> {
  const { checkbox } = await import('@inquirer/prompts')

  const choices = AI_TOOLS.map((tool) => {
    const detected = detectedIds.has(tool.value)
    return {
      name: detected ? `${tool.name} \x1b[32m(detected)\x1b[0m` : tool.name,
      value: tool.value,
      checked: detected,
    }
  })

  const selected = await checkbox({
    message: `연결할 에이전트 CLI를 선택하세요`,
    choices,
    pageSize: 8,
  })

  return selected
}

/**
 * 글로벌 User 커맨드를 감지된 모든 에이전트 CLI에 설치한다.
 * ~/{skillsDir}/commands/relay/ 에 설치.
 * 기존 파일 중 현재 커맨드 목록에 없는 것은 제거한다.
 */
export function installGlobalUserCommands(): { installed: boolean; commands: string[]; tools: string[] } {
  const globalCLIs = detectGlobalCLIs()
  const currentIds = new Set(USER_COMMANDS.map((c) => c.id))
  const commands: string[] = []
  const tools: string[] = []

  // 감지된 CLI가 없으면 Claude Code에만 설치 (기본)
  const targetDirs = globalCLIs.length > 0
    ? globalCLIs.map((t) => ({ name: t.name, dir: getGlobalCommandDirForTool(t.skillsDir), getPath: (id: string) => getGlobalCommandPathForTool(t.skillsDir, id) }))
    : [{ name: 'Claude Code', dir: getGlobalCommandDir(), getPath: (id: string) => getGlobalCommandPath(id) }]

  for (const target of targetDirs) {
    fs.mkdirSync(target.dir, { recursive: true })

    // 기존 파일 중 현재 목록에 없는 것 제거
    for (const file of fs.readdirSync(target.dir)) {
      const id = file.replace(/\.md$/, '')
      if (!currentIds.has(id)) {
        fs.unlinkSync(path.join(target.dir, file))
      }
    }

    // 현재 커맨드 설치 (덮어쓰기)
    for (const cmd of USER_COMMANDS) {
      fs.writeFileSync(target.getPath(cmd.id), formatCommandFile(cmd))
    }

    tools.push(target.name)
  }

  // commands 목록은 한 번만
  for (const cmd of USER_COMMANDS) {
    commands.push(cmd.id)
  }

  return { installed: true, commands, tools }
}

/**
 * 글로벌 User 커맨드가 이미 설치되어 있는지 확인한다.
 */
export function hasGlobalUserCommands(): boolean {
  return USER_COMMANDS.every((cmd) =>
    fs.existsSync(getGlobalCommandPath(cmd.id))
  )
}

/**
 * 팀 프로젝트인지 감지한다 (.relay/ 디렉토리 내 relay.yaml 또는 팀 디렉토리 구조).
 */
function isTeamProject(projectPath: string): boolean {
  const relayDir = path.join(projectPath, '.relay')
  if (!fs.existsSync(relayDir)) return false

  if (fs.existsSync(path.join(relayDir, 'relay.yaml'))) {
    return true
  }

  return VALID_TEAM_DIRS.some((d) => {
    const dirPath = path.join(relayDir, d)
    if (!fs.existsSync(dirPath)) return false
    return fs.readdirSync(dirPath).filter((f) => !f.startsWith('.')).length > 0
  })
}


export function registerInit(program: Command): void {
  program
    .command('init')
    .description('에이전트 CLI에 relay 슬래시 커맨드를 설치합니다')
    .option('--tools <tools>', '설치할 에이전트 CLI 지정 (쉼표 구분)')
    .option('--all', '감지된 모든 에이전트 CLI에 설치')
    .option('--auto', '대화형 프롬프트 없이 자동으로 모든 감지된 CLI에 설치')
    .action(async (opts: { tools?: string; all?: boolean; auto?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // auto mode: --auto flag, --all flag, or stdin is not a TTY (but NOT --json alone)
      const autoMode = opts.auto === true || opts.all === true || !process.stdin.isTTY

      const projectPath = process.cwd()
      const detected = detectAgentCLIs(projectPath)
      const detectedIds = new Set(detected.map((t) => t.value))
      const isBuilder = isTeamProject(projectPath)

      // ── 0. --json 모드에서 --tools/--all 없으면 MISSING_TOOLS 에러 ──
      if (json && !opts.tools && !opts.all && !opts.auto) {
        const detectedOptions = detected.map((t) => ({ value: t.value, label: t.name }))
        if (detectedOptions.length === 0) {
          detectedOptions.push(...AI_TOOLS.slice(0, 5).map((t) => ({ value: t.value, label: t.name })))
        }
        console.error(JSON.stringify({
          error: 'MISSING_TOOLS',
          message: '설치할 에이전트 CLI를 선택하세요.',
          fix: `relay init --tools <도구1,도구2> --json 또는 relay init --all --json`,
          options: detectedOptions,
        }))
        process.exit(1)
      }

      // ── 1. 글로벌 User 커맨드 설치 ──
      let globalStatus: 'installed' | 'updated' | 'already' = 'already'

      let globalTools: string[] = []

      {
        const result = installGlobalUserCommands()
        globalStatus = hasGlobalUserCommands() ? 'updated' : 'installed'
        globalTools = result.tools

        // Register relay-core in installed.json
        const installed = loadInstalled()
        installed['relay-core'] = {
          version: pkg.version,
          installed_at: new Date().toISOString(),
          files: result.commands.map((c) => getGlobalCommandPath(c)),
          type: 'system',
        }
        saveInstalled(installed)
      }

      // ── 2. 로컬 Builder 커맨드 (팀 프로젝트인 경우) ──
      // relay-publish가 글로벌로 승격되어 BUILDER_COMMANDS가 비어있으면 스킵
      const localResults: { tool: string; commands: string[] }[] = []

      if (isBuilder && BUILDER_COMMANDS.length > 0) {
        // 도구 선택
        let targetToolIds: string[]

        if (opts.tools) {
          targetToolIds = resolveTools(opts.tools)
        } else if (!autoMode) {
          // interactive mode: only when stdin is a TTY and not --auto/--json
          showWelcome()

          if (detected.length > 0) {
            console.log(`  감지된 에이전트 CLI: \x1b[36m${detected.map((t) => t.name).join(', ')}\x1b[0m\n`)
          }

          console.log('  \x1b[2mBuilder 프로젝트 감지 → 로컬 Builder 커맨드도 설치합니다.\x1b[0m\n')

          targetToolIds = await selectToolsInteractively(detectedIds)

          if (targetToolIds.length === 0) {
            console.log('\n  선택된 도구가 없습니다.')
            // 글로벌은 이미 설치됨
            if (globalStatus === 'installed') {
              console.log('  글로벌 User 커맨드는 설치되었습니다.\n')
            }
            return
          }
        } else {
          // auto mode: use detected CLIs, or all available tools if none detected
          if (detected.length > 0) {
            targetToolIds = detected.map((t) => t.value)
          } else {
            targetToolIds = AI_TOOLS.map((t) => t.value)
          }
        }

        // Builder 커맨드 설치 (기존 파일 중 현재 목록에 없는 것 제거)
        const builderIds = new Set(BUILDER_COMMANDS.map((c) => c.id))

        for (const toolId of targetToolIds) {
          const tool = AI_TOOLS.find((t) => t.value === toolId)
          if (!tool) continue

          const adapter = createAdapter(tool)
          const localDir = path.join(projectPath, tool.skillsDir, 'commands', 'relay')

          // 기존 로컬 커맨드 중 Builder 목록에 없는 것 제거
          if (fs.existsSync(localDir)) {
            for (const file of fs.readdirSync(localDir)) {
              const id = file.replace(/\.md$/, '')
              if (!builderIds.has(id)) {
                fs.unlinkSync(path.join(localDir, file))
              }
            }
          }

          const installedCommands: string[] = []

          for (const cmd of BUILDER_COMMANDS) {
            const filePath = path.join(projectPath, adapter.getFilePath(cmd.id))
            const fileContent = adapter.formatFile(cmd)

            fs.mkdirSync(path.dirname(filePath), { recursive: true })
            fs.writeFileSync(filePath, fileContent)
            installedCommands.push(cmd.id)
          }

          localResults.push({ tool: tool.name, commands: installedCommands })
        }
      } else if (!autoMode) {
        // User 모드: 글로벌만 설치, 안내 표시
        showWelcome()
      }

      // ── 3. 출력 ──
      if (json) {
        console.log(JSON.stringify({
          status: 'ok',
          mode: isBuilder ? 'builder' : 'user',
          global: {
            status: globalStatus,
            path: getGlobalCommandDir(),
            commands: USER_COMMANDS.map((c) => c.id),
          },
          local: isBuilder ? localResults : undefined,
        }))
      } else {
        console.log(`\n\x1b[32m✓ relay 초기화 완료\x1b[0m\n`)

        // 글로벌
        {
          const toolNames = globalTools.length > 0 ? globalTools.join(', ') : 'Claude Code'
          console.log(`  \x1b[36mUser 커맨드 (글로벌)\x1b[0m — ${globalStatus === 'updated' ? '업데이트됨' : '설치됨'}`)
          console.log(`  감지된 CLI: \x1b[36m${toolNames}\x1b[0m`)
          for (const cmd of USER_COMMANDS) {
            console.log(`    /${cmd.id}`)
          }
          console.log()
        }

        // 로컬 Builder
        if (localResults.length > 0) {
          console.log(`  \x1b[36mBuilder 커맨드 (로컬)\x1b[0m`)
          for (const r of localResults) {
            console.log(`    ${r.tool}`)
            for (const cmd of r.commands) {
              console.log(`      /${cmd}`)
            }
          }
          console.log()
        }

        if (!isBuilder) {
          console.log('  팀을 만들려면 \x1b[33mrelay create <name>\x1b[0m을 사용하세요.')
          console.log()
        }

        console.log('  IDE를 재시작하면 슬래시 커맨드가 활성화됩니다.')
      }
    })
}
