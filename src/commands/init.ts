import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { detectAgentCLIs, detectGlobalCLIs, AI_TOOLS, type AITool } from '../lib/ai-tools.js'
import { resolveProjectPath } from '../lib/paths.js'
import {
  USER_COMMANDS,
  formatCommandFile,
  getGlobalCommandDir,
  getGlobalCommandPath,
  getGlobalCommandDirForTool,
  getGlobalCommandPathForTool,
} from '../lib/command-adapter.js'
import { loadInstalled, saveInstalled } from '../lib/config.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

function showWelcome(): void {
  const lines = [
    '',
    '  \x1b[33m⚡\x1b[0m \x1b[1manpm\x1b[0m — Agent Marketplace',
    '',
    '  에이전트 CLI에 anpm 커맨드를 연결합니다.',
    '',
    '  \x1b[2mUser 커맨드 (글로벌)\x1b[0m',
    '  /anpm-explore     에이전트 탐색 & 추천',
    '  /anpm-create      에이전트 생성 & 배포',
    '  /anpm-status      설치 현황 & Organization',
    '  /anpm-uninstall   에이전트 삭제',
    '',
    '  \x1b[2mCLI 명령어\x1b[0m',
    '  anpm install      에이전트 설치 (CLI 한 줄 완결)',
    '  anpm publish      재배포 (--patch/--minor/--major)',
    '',
  ]
  console.log(lines.join('\n'))
}

/**
 * 글로벌 User 커맨드를 감지된 모든 에이전트 CLI에 설치한다.
 * ~/{skillsDir}/commands/anpm/ 에 설치.
 * 기존 파일 중 현재 커맨드 목록에 없는 것은 제거한다.
 */
/** 제거된 레거시 커맨드 → 대체 안내 매핑 */
const LEGACY_COMMANDS: Record<string, string> = {
  'relay-install': 'anpm install (CLI) 또는 /anpm-explore',
  'relay-publish': 'anpm publish --patch (CLI) 또는 /anpm-create',
}

export function installGlobalUserCommands(overrideTools?: AITool[]): { installed: boolean; commands: string[]; tools: string[]; removed: string[] } {
  const globalCLIs = overrideTools ?? detectGlobalCLIs()
  const currentIds = new Set(USER_COMMANDS.map((c) => c.id))
  const commands: string[] = []
  const tools: string[] = []
  const removed: string[] = []

  const targetDirs = globalCLIs.map((t) => ({ name: t.name, dir: getGlobalCommandDirForTool(t.skillsDir), getPath: (id: string) => getGlobalCommandPathForTool(t.skillsDir, id) }))

  for (const target of targetDirs) {
    fs.mkdirSync(target.dir, { recursive: true })

    // 기존 파일 중 현재 목록에 없는 것 제거 + 레거시 안내
    for (const file of fs.readdirSync(target.dir)) {
      const id = file.replace(/\.md$/, '')
      if (!currentIds.has(id)) {
        fs.unlinkSync(path.join(target.dir, file))
        if (LEGACY_COMMANDS[id] && !removed.includes(id)) {
          removed.push(id)
        }
      }
    }

    // 현재 커맨드 설치 (덮어쓰기)
    for (const cmd of USER_COMMANDS) {
      fs.writeFileSync(target.getPath(cmd.id), formatCommandFile(cmd))
    }

    tools.push(target.name)
  }

  for (const cmd of USER_COMMANDS) {
    commands.push(cmd.id)
  }

  return { installed: true, commands, tools, removed }
}

/**
 * 글로벌 User 커맨드가 이미 설치되어 있는지 확인한다.
 */
export function hasGlobalUserCommands(overrideTools?: AITool[]): boolean {
  if (overrideTools) {
    return overrideTools.every((tool) =>
      USER_COMMANDS.every((cmd) =>
        fs.existsSync(getGlobalCommandPathForTool(tool.skillsDir, cmd.id))
      )
    )
  }
  return USER_COMMANDS.every((cmd) =>
    fs.existsSync(getGlobalCommandPath(cmd.id))
  )
}


export function registerInit(program: Command): void {
  program
    .command('init')
    .description('에이전트 CLI에 anpm 슬래시 커맨드를 설치합니다')
    .option('--tools <tools>', '설치할 에이전트 CLI 지정 (쉼표 구분)')
    .option('--all', '감지된 모든 에이전트 CLI에 설치')
    .option('--auto', '대화형 프롬프트 없이 자동으로 모든 감지된 CLI에 설치')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: ANPM_PROJECT_PATH)')
    .action(async (opts: { tools?: string; all?: boolean; auto?: boolean; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // auto mode: --auto flag, --all flag, or stdin is not a TTY (but NOT --json alone)
      const autoMode = opts.auto === true || opts.all === true || !process.stdin.isTTY

      const projectPath = resolveProjectPath(opts.project)
      const detected = detectAgentCLIs(projectPath)

      // ── 0. --json 모드에서 --tools/--all 없으면 MISSING_TOOLS 에러 ──
      if (json && !opts.tools && !opts.all && !opts.auto) {
        const detectedOptions = detected.map((t) => ({ value: t.value, label: t.name }))
        if (detectedOptions.length === 0) {
          detectedOptions.push(...AI_TOOLS.slice(0, 5).map((t) => ({ value: t.value, label: t.name })))
        }
        console.error(JSON.stringify({
          error: 'MISSING_TOOLS',
          message: '설치할 에이전트 CLI를 선택하세요.',
          fix: `anpm init --tools <도구1,도구2> --json 또는 anpm init --all --json`,
          options: detectedOptions,
        }))
        process.exit(1)
      }

      // ── 1. 글로벌 User 커맨드 설치 ──
      let globalStatus: 'installed' | 'updated' | 'already' = 'already'

      let globalTools: string[] = []

      let removedCommands: string[] = []
      {
        const result = installGlobalUserCommands()
        globalStatus = hasGlobalUserCommands() ? 'updated' : 'installed'
        globalTools = result.tools
        removedCommands = result.removed

        // Register relay-core in installed.json
        const installed = loadInstalled()
        installed['anpm-core'] = {
          version: pkg.version,
          installed_at: new Date().toISOString(),
          files: result.commands.map((c) => getGlobalCommandPath(c)),
          type: 'system',
        }
        saveInstalled(installed)
      }

      if (!autoMode) {
        showWelcome()
      }

      // ── 2. 출력 ──
      if (json) {
        console.log(JSON.stringify({
          status: 'ok',
          global: {
            status: globalStatus,
            path: getGlobalCommandDir(),
            commands: USER_COMMANDS.map((c) => c.id),
          },
        }))
      } else {
        console.log(`\n\x1b[32m✓ anpm 초기화 완료\x1b[0m\n`)

        // 레거시 커맨드 마이그레이션 안내
        if (removedCommands.length > 0) {
          console.log(`  \x1b[33m⚠ 변경된 커맨드:\x1b[0m`)
          for (const id of removedCommands) {
            console.log(`    \x1b[31m✗ /${id}\x1b[0m → ${LEGACY_COMMANDS[id]}`)
          }
          console.log()
        }

        // 글로벌
        {
          const toolNames = globalTools.length > 0 ? globalTools.join(', ') : '(감지된 CLI 없음)'
          console.log(`  \x1b[36m커맨드 (글로벌)\x1b[0m — ${globalStatus === 'updated' ? '업데이트됨' : '설치됨'}`)
          console.log(`  감지된 CLI: \x1b[36m${toolNames}\x1b[0m`)
          for (const cmd of USER_COMMANDS) {
            console.log(`    /${cmd.id}`)
          }
          console.log()
        }

        console.log('  에이전트를 만들려면 \x1b[33manpm create <name>\x1b[0m을 사용하세요.')
        console.log()
        console.log('  IDE를 재시작하면 슬래시 커맨드가 활성화됩니다.')
      }
    })
}
