import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import yaml from 'js-yaml'
import { detectAgentCLIs } from '../lib/ai-tools.js'
import {
  createAdapter,
  BUILDER_COMMANDS,
} from '../lib/command-adapter.js'
import { installGlobalUserCommands, hasGlobalUserCommands } from './init.js'
import { slugify } from '../lib/slug.js'
import { resolveProjectPath } from '../lib/paths.js'

const DEFAULT_DIRS = ['.relay/skills', '.relay/commands'] as const

/**
 * 글로벌 User 커맨드가 없으면 설치한다.
 */
function ensureGlobalUserCommands(): boolean {
  if (hasGlobalUserCommands()) return false
  installGlobalUserCommands()
  return true
}

export function registerCreate(program: Command): void {
  program
    .command('create <name>')
    .description('새 에이전트 프로젝트를 생성합니다')
    .option('--description <desc>', '에이전트 설명')
    .option('--slug <slug>', 'URL용 식별자 (영문 소문자, 숫자, 하이픈)')
    .option('--tags <tags>', '태그 (쉼표 구분)')
    .option('--visibility <visibility>', '공개 범위 (public, private, internal)')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .action(async (name: string, opts: { description?: string; slug?: string; tags?: string; visibility?: string; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')
      const isTTY = Boolean(process.stdin.isTTY) && !json

      // 1. .relay/relay.yaml 이미 존재하면 에러
      if (fs.existsSync(relayYamlPath)) {
        if (json) {
          console.error(JSON.stringify({ error: 'ALREADY_EXISTS', message: '.relay/relay.yaml이 이미 존재합니다.', fix: '기존 .relay/relay.yaml을 확인하세요. 새로 시작하려면 삭제 후 재시도.' }))
        } else {
          console.error('.relay/relay.yaml이 이미 존재합니다. 기존 에이전트 프로젝트에서는 `relay init`을 사용하세요.')
        }
        process.exit(1)
      }

      // 2. 메타데이터 수집
      let slug = opts.slug ?? slugify(name)

      let description = opts.description ?? ''
      let tags: string[] = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
      let visibility: 'public' | 'private' | 'internal' = (opts.visibility as 'public' | 'private' | 'internal') ?? 'public'

      if (json) {
        // --json 모드: slug가 비어있으면 에러
        if (!slug) {
          console.error(JSON.stringify({
            error: 'INVALID_SLUG',
            message: '이름에서 유효한 slug를 생성할 수 없습니다. 영문 이름을 사용하거나 --slug 옵션을 지정하세요.',
            fix: `relay create "${name}" --slug <영문-slug> --description <설명> --json`,
          }))
          process.exit(1)
        }
        // --json 모드: 필수 값 부족 시 에러 반환 (프롬프트 없음)
        if (!opts.description) {
          console.error(JSON.stringify({
            error: 'MISSING_FIELD',
            message: '에이전트 설명이 필요합니다.',
            fix: `relay create ${name} --description <설명> --json`,
            field: 'description',
          }))
          process.exit(1)
        }
        if (!opts.visibility) {
          console.error(JSON.stringify({
            error: 'MISSING_VISIBILITY',
            message: '공개 범위를 선택하세요.',
            fix: `relay create ${name} --description "${description}" --visibility <visibility> --json`,
            options: [
              { value: 'public', label: '공개 — 누구나 설치' },
              { value: 'private', label: '링크 공유 — 접근 링크가 있는 사람만' },
              { value: 'internal', label: '비공개 — Org 멤버만' },
            ],
          }))
          process.exit(1)
        }
        if (!['public', 'private', 'internal'].includes(opts.visibility)) {
          console.error(JSON.stringify({
            error: 'INVALID_FIELD',
            message: `유효하지 않은 visibility 값: ${opts.visibility}`,
            fix: `visibility는 public, private, internal 중 하나여야 합니다.`,
            options: [
              { value: 'public', label: '공개' },
              { value: 'private', label: '링크 공유' },
              { value: 'internal', label: '비공개' },
            ],
          }))
          process.exit(1)
        }
      } else if (isTTY) {
        const { input: promptInput, select: promptSelect } = await import('@inquirer/prompts')

        console.log(`\n  \x1b[33m⚡\x1b[0m \x1b[1mrelay create\x1b[0m — 새 에이전트 프로젝트\n`)

        // slug가 비어있으면 (한국어 등 비ASCII 이름) slug를 직접 입력받음
        if (!slug) {
          slug = await promptInput({
            message: 'Slug (URL/설치에 사용되는 영문 식별자):',
            validate: (v) => {
              const trimmed = v.trim()
              if (!trimmed) return 'slug를 입력해주세요.'
              if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return '소문자, 숫자, 하이픈만 사용 가능합니다.'
              return true
            },
          })
          slug = slug.trim()
        }

        if (!description) {
          description = await promptInput({
            message: '에이전트 설명:',
            validate: (v) => v.trim().length > 0 ? true : '설명을 입력해주세요.',
          })
        }

        if (!opts.tags) {
          const tagsRaw = await promptInput({
            message: '태그 (쉼표로 구분, 선택):',
            default: '',
          })
          tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
        }

        if (!opts.visibility) {
          visibility = await promptSelect<'public' | 'private' | 'internal'>({
            message: '공개 범위:',
            choices: [
              { name: '공개', value: 'public' },
              { name: '링크 공유 (접근 링크 필요)', value: 'private' },
              { name: '비공개 (Org 멤버만)', value: 'internal' },
            ],
          })
        }
      }

      // 3. .relay/relay.yaml 생성
      fs.mkdirSync(relayDir, { recursive: true })
      const yamlData: Record<string, unknown> = {
        name,
        slug: slug,
        description,
        version: '1.0.0',
        type: 'hybrid',
        tags,
        visibility,
        contents: [],
      }
      fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')

      // 4. 디렉토리 구조 생성
      const createdDirs: string[] = []
      for (const dir of DEFAULT_DIRS) {
        const dirPath = path.join(projectPath, dir)
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
          createdDirs.push(dir)
        }
      }

      // 5. 로컬 Builder 슬래시 커맨드 설치
      const detected = detectAgentCLIs(projectPath)
      const localResults: { tool: string; commands: string[] }[] = []

      for (const tool of detected) {
        const adapter = createAdapter(tool)
        const installed: string[] = []

        for (const cmd of BUILDER_COMMANDS) {
          const filePath = path.join(projectPath, adapter.getFilePath(cmd.id))
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, adapter.formatFile(cmd))
          installed.push(cmd.id)
        }

        localResults.push({ tool: tool.name, commands: installed })
      }

      // 6. 글로벌 User 커맨드 (없으면 설치)
      const globalInstalled = ensureGlobalUserCommands()

      // 7. 출력
      if (json) {
        console.log(JSON.stringify({
          status: 'ok',
          name,
          slug: slug,
          relay_yaml: 'created',
          directories: createdDirs,
          local_commands: localResults,
          global_commands: globalInstalled ? 'installed' : 'already',
        }))
      } else {
        console.log(`\n\x1b[32m✓ ${name} 에이전트 프로젝트 생성 완료\x1b[0m\n`)
        console.log(`  .relay/relay.yaml 생성됨`)
        if (createdDirs.length > 0) {
          console.log(`  디렉토리 생성: ${createdDirs.join(', ')}`)
        }

        if (localResults.length > 0) {
          console.log(`\n  \x1b[36mBuilder 커맨드 (로컬)\x1b[0m`)
          for (const r of localResults) {
            console.log(`    ${r.tool}: ${r.commands.map((c) => `/${c}`).join(', ')}`)
          }
        }

        if (globalInstalled) {
          console.log(`\n  \x1b[36mUser 커맨드 (글로벌)\x1b[0m — 설치됨`)
        }

        console.log(`\n  다음 단계: \x1b[33m/relay-publish\x1b[0m로 Space에 배포`)
        console.log('  IDE를 재시작하면 슬래시 커맨드가 활성화됩니다.\n')
      }
    })
}
