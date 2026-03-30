import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Command } from 'commander'
import yaml from 'js-yaml'
import {
  detectAgentCLIs,
  detectGlobalCLIs,
  scanLocalItems,
  scanGlobalItems,
  type ContentItem,
} from '../lib/ai-tools.js'
import { resolveProjectPath, resolveHome } from '../lib/paths.js'

const SYNC_DIRS = ['skills', 'commands', 'agents', 'rules'] as const

// ─── Types ───

interface FileEntry {
  /** .relay/ 기준 상대 경로 (예: skills/my-skill/SKILL.md) */
  relPath: string
  hash: string
}

type DiffStatus = 'added' | 'modified' | 'deleted' | 'unchanged'

interface DiffEntry {
  relPath: string
  status: DiffStatus
}

// ─── Contents Manifest Types ───

import type { ContentType } from '../lib/ai-tools.js'

export interface ContentEntry {
  name: string
  type: ContentType
  from: string // 상대 경로(.claude/skills/x) 또는 글로벌(~/.claude/skills/x)
}

type ContentDiffStatus = 'modified' | 'unchanged' | 'source_missing'

interface ContentDiffEntry {
  name: string
  type: ContentType
  status: ContentDiffStatus
  files?: DiffEntry[]
}

interface NewItemEntry {
  name: string
  type: ContentType
  source: string
  relativePath: string
}

interface ContentsPackageResult {
  diff: ContentDiffEntry[]
  new_items: NewItemEntry[]
  synced: boolean
  summary: {
    modified: number
    unchanged: number
    source_missing: number
    new_available: number
  }
}

// ─── Helpers ───

function fileHash(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * 소스와 .relay/를 비교하여 diff를 생성한다.
 */
function computeDiff(sourceFiles: FileEntry[], relayFiles: FileEntry[]): DiffEntry[] {
  const relayMap = new Map(relayFiles.map((f) => [f.relPath, f.hash]))
  const sourceMap = new Map(sourceFiles.map((f) => [f.relPath, f.hash]))
  const diff: DiffEntry[] = []

  // 소스에 있는 파일
  for (const [relPath, hash] of sourceMap) {
    const relayHash = relayMap.get(relPath)
    if (!relayHash) {
      diff.push({ relPath, status: 'added' })
    } else if (relayHash !== hash) {
      diff.push({ relPath, status: 'modified' })
    } else {
      diff.push({ relPath, status: 'unchanged' })
    }
  }

  // .relay/에만 있는 파일 (소스에서 삭제됨)
  for (const [relPath] of relayMap) {
    if (!sourceMap.has(relPath)) {
      diff.push({ relPath, status: 'deleted' })
    }
  }

  return diff.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * 소스에서 .relay/로 파일을 동기화한다.
 */
function syncToRelay(sourceBase: string, relayDir: string, diff: DiffEntry[]): void {
  for (const entry of diff) {
    const sourcePath = path.join(sourceBase, entry.relPath)
    const relayPath = path.join(relayDir, entry.relPath)

    if (entry.status === 'added' || entry.status === 'modified') {
      fs.mkdirSync(path.dirname(relayPath), { recursive: true })
      fs.copyFileSync(sourcePath, relayPath)
    } else if (entry.status === 'deleted') {
      if (fs.existsSync(relayPath)) {
        fs.unlinkSync(relayPath)
        // 빈 디렉토리 정리
        const parentDir = path.dirname(relayPath)
        try {
          const remaining = fs.readdirSync(parentDir).filter((f) => !f.startsWith('.'))
          if (remaining.length === 0) fs.rmdirSync(parentDir)
        } catch { /* ignore */ }
      }
    }
  }
}

// ─── Contents-based Helpers ───

/**
 * from 경로를 절대 경로로 해석한다.
 * ~/로 시작하면 홈 디렉토리, 그 외는 projectPath 기준 상대 경로.
 */
function resolveFromPath(fromPath: string, projectPath: string): string {
  if (fromPath.startsWith('~/')) {
    return path.join(os.homedir(), fromPath.slice(2))
  }
  return path.join(projectPath, fromPath)
}

/**
 * 파일 또는 디렉토리의 모든 파일을 재귀 스캔하여 FileEntry[]를 반환한다.
 * relPath는 baseDir 기준.
 */
function scanPath(absPath: string): FileEntry[] {
  if (!fs.existsSync(absPath)) return []

  const stat = fs.statSync(absPath)
  if (stat.isFile()) {
    return [{ relPath: path.basename(absPath), hash: fileHash(absPath) }]
  }

  // 디렉토리
  const entries: FileEntry[] = []
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else {
        entries.push({ relPath: path.relative(absPath, fullPath), hash: fileHash(fullPath) })
      }
    }
  }
  walk(absPath)
  return entries
}

/**
 * contents 매니페스트 기반으로 각 항목의 원본과 .relay/ 복사본을 비교한다.
 */
function computeContentsDiff(
  contents: ContentEntry[],
  relayDir: string,
  projectPath: string,
): { diff: ContentDiffEntry[]; newItems: NewItemEntry[] } {
  const diff: ContentDiffEntry[] = []

  for (const entry of contents) {
    const absFrom = resolveFromPath(entry.from, projectPath)

    if (!fs.existsSync(absFrom)) {
      diff.push({ name: entry.name, type: entry.type, status: 'source_missing' })
      continue
    }

    // from 경로에서 .relay/ 내 대응 위치 결정
    // from: .claude/skills/code-review → .relay/skills/code-review
    // from: ~/.claude/skills/code-review → .relay/skills/code-review
    const relaySubPath = deriveRelaySubPath(entry)
    const relayItemDir = path.join(relayDir, relaySubPath)

    const sourceFiles = scanPath(absFrom)
    const relayFiles = scanPath(relayItemDir)

    const fileDiff = computeDiff(sourceFiles, relayFiles)
    const hasChanges = fileDiff.some((d) => d.status !== 'unchanged')

    diff.push({
      name: entry.name,
      type: entry.type,
      status: hasChanges ? 'modified' : 'unchanged',
      files: hasChanges ? fileDiff.filter((d) => d.status !== 'unchanged') : undefined,
    })
  }

  // 소스 디렉토리를 다시 스캔하여 contents에 없는 새 항목 탐지
  const newItems = discoverNewItems(contents, projectPath)

  return { diff, newItems }
}

/**
 * contents 항목의 from 경로에서 .relay/ 내 서브경로를 유도한다.
 * 예: .claude/skills/code-review → skills/code-review
 *     ~/.claude/agents/dev-lead.md → agents/dev-lead.md
 */
function deriveRelaySubPath(entry: ContentEntry): string {
  const from = entry.from.startsWith('~/') ? entry.from.slice(2) : entry.from
  // skills/xxx, agents/xxx 등의 패턴을 추출
  for (const dir of SYNC_DIRS) {
    const idx = from.indexOf(`/${dir}/`)
    if (idx !== -1) {
      return from.slice(idx + 1) // /skills/code-review → skills/code-review
    }
  }
  // fallback: type + name
  return `${entry.type}s/${entry.name}`
}

/**
 * contents에 등록되지 않은 새 항목을 소스 디렉토리에서 찾는다.
 */
function discoverNewItems(contents: ContentEntry[], projectPath: string): NewItemEntry[] {
  const existingNames = new Set(contents.map((c) => `${c.type}:${c.name}`))
  const newItems: NewItemEntry[] = []

  // 로컬 소스 스캔
  const localTools = detectAgentCLIs(projectPath)
  for (const tool of localTools) {
    const items = scanLocalItems(projectPath, tool)
    for (const item of items) {
      if (!existingNames.has(`${item.type}:${item.name}`)) {
        newItems.push({
          name: item.name,
          type: item.type,
          source: tool.skillsDir,
          relativePath: item.relativePath,
        })
      }
    }
  }

  // 글로벌 소스 스캔
  const globalTools = detectGlobalCLIs()
  for (const tool of globalTools) {
    const items = scanGlobalItems(tool)
    for (const item of items) {
      if (!existingNames.has(`${item.type}:${item.name}`)) {
        newItems.push({
          name: item.name,
          type: item.type,
          source: `~/${tool.skillsDir}`,
          relativePath: item.relativePath,
        })
      }
    }
  }

  return newItems
}

/**
 * contents 항목 단위로 from → .relay/ 동기화한다.
 */
function syncContentsToRelay(
  contents: ContentEntry[],
  contentsDiff: ContentDiffEntry[],
  relayDir: string,
  projectPath: string,
): void {
  for (const diffEntry of contentsDiff) {
    if (diffEntry.status !== 'modified') continue

    const content = contents.find((c) => c.name === diffEntry.name && c.type === diffEntry.type)
    if (!content) continue

    const absFrom = resolveFromPath(content.from, projectPath)
    const relaySubPath = deriveRelaySubPath(content)
    const relayItemDir = path.join(relayDir, relaySubPath)

    // 소스 파일을 .relay/로 복사
    const sourceFiles = scanPath(absFrom)
    const relayFiles = scanPath(relayItemDir)
    const fileDiff = computeDiff(sourceFiles, relayFiles)
    syncToRelay(absFrom, relayItemDir, fileDiff)
  }
}

// ─── Global Agent Home ───

/**
 * 패키지 홈 디렉토리를 결정한다.
 * 1. 프로젝트에 .relay/가 있으면 → projectPath/.relay/
 * 2. 없으면 → ~/.relay/agents/<slug>/ (slug 필요)
 *
 * slug가 없고 프로젝트에도 .relay/가 없으면 null 반환.
 */
export function resolveRelayDir(projectPath: string, slug?: string): string | null {
  const projectRelay = path.join(projectPath, '.relay')
  if (fs.existsSync(path.join(projectRelay, 'relay.yaml'))) {
    return projectRelay
  }
  // .relay/ 디렉토리는 있지만 relay.yaml이 없는 경우도 프로젝트 모드
  if (fs.existsSync(projectRelay)) {
    return projectRelay
  }
  // 글로벌 에이전트 홈
  if (slug) {
    return path.join(os.homedir(), '.relay', 'agents', slug)
  }
  return null
}

/**
 * 글로벌 에이전트 홈에 패키지 구조를 초기화한다.
 */
export function initGlobalAgentHome(slug: string, yamlData: Record<string, unknown>): string {
  const agentDir = path.join(os.homedir(), '.relay', 'agents', slug)
  fs.mkdirSync(agentDir, { recursive: true })
  fs.mkdirSync(path.join(agentDir, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(agentDir, 'agents'), { recursive: true })
  fs.writeFileSync(
    path.join(agentDir, 'relay.yaml'),
    yaml.dump(yamlData, { lineWidth: 120 }),
    'utf-8',
  )
  return agentDir
}

// ─── Command ───

export function registerPackage(program: Command): void {
  program
    .command('package')
    .description('소스 디렉토리에서 .relay/로 콘텐츠를 동기화합니다')
    .option('--source <dir>', '소스 디렉토리 지정 (예: .claude)')
    .option('--sync', '변경사항을 .relay/에 즉시 반영', false)
    .option('--init', '최초 패키징: 소스 감지 → .relay/ 초기화', false)
    .option('--migrate', '기존 source 필드를 contents로 마이그레이션', false)
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .option('--home <dir>', '홈 디렉토리 경로 (기본: os.homedir(), 환경변수: RELAY_HOME)')
    .action(async (opts: { source?: string; sync?: boolean; init?: boolean; migrate?: boolean; project?: string; home?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const homeDir = resolveHome(opts.home)
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')

      // ─── 최초 패키징 (--init) ───
      if (opts.init || !fs.existsSync(relayYamlPath)) {
        // 로컬 + 글로벌 소스를 모두 스캔하여 개별 항목 목록 생성
        const localTools = detectAgentCLIs(projectPath)
        const globalTools = detectGlobalCLIs(homeDir)

        interface SourceEntry {
          path: string
          location: 'local' | 'global'
          name: string
          items: ContentItem[]
        }

        const sources: SourceEntry[] = []

        for (const tool of localTools) {
          const items = scanLocalItems(projectPath, tool)
          if (items.length > 0) {
            sources.push({
              path: tool.skillsDir,
              location: 'local',
              name: tool.name,
              items,
            })
          }
        }

        for (const tool of globalTools) {
          const items = scanGlobalItems(tool, homeDir)
          if (items.length > 0) {
            sources.push({
              path: `~/${tool.skillsDir}`,
              location: 'global',
              name: `${tool.name} (global)`,
              items,
            })
          }
        }

        // ~/.relay/agents/ 에 기존 에이전트 패키지가 있는지 스캔
        const globalAgentsDir = path.join(homeDir ?? os.homedir(), '.relay', 'agents')
        const existingAgents: { slug: string; name: string; version: string; path: string }[] = []
        if (fs.existsSync(globalAgentsDir)) {
          for (const entry of fs.readdirSync(globalAgentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue
            const agentYaml = path.join(globalAgentsDir, entry.name, 'relay.yaml')
            if (fs.existsSync(agentYaml)) {
              try {
                const cfg = yaml.load(fs.readFileSync(agentYaml, 'utf-8')) as Record<string, unknown>
                existingAgents.push({
                  slug: (cfg.slug as string) ?? entry.name,
                  name: (cfg.name as string) ?? entry.name,
                  version: (cfg.version as string) ?? '0.0.0',
                  path: `~/.relay/agents/${entry.name}`,
                })
              } catch { /* skip invalid yaml */ }
            }
          }
        }

        if (json) {
          console.log(JSON.stringify({
            status: 'init_required',
            sources,
            existing_agents: existingAgents,
          }))
        } else {
          if (sources.length === 0 && existingAgents.length === 0) {
            console.error('배포 가능한 에이전트 콘텐츠를 찾지 못했습니다.')
            console.error('skills/, commands/, agents/, rules/ 중 하나를 만들어주세요.')
            process.exit(1)
          }

          if (sources.length > 0) {
            console.error('\n발견된 에이전트 콘텐츠:\n')
            for (const src of sources) {
              const typeCounts = new Map<string, number>()
              for (const item of src.items) {
                typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1)
              }
              const parts = Array.from(typeCounts.entries())
                .map(([t, c]) => `${t} ${c}개`)
                .join(', ')
              const label = src.location === 'global' ? '🌐' : '📁'
              console.error(`  ${label} ${src.path}/ — ${parts}`)
            }
          }

          if (existingAgents.length > 0) {
            console.error('\n기존 글로벌 에이전트:\n')
            for (const agent of existingAgents) {
              console.error(`  📦 ${agent.name} (v${agent.version}) — ${agent.path}`)
            }
          }

          console.error('')
        }
        return
      }

      // ─── 마이그레이션 (--migrate) ───
      if (opts.migrate) {
        const yamlMigrate = fs.readFileSync(relayYamlPath, 'utf-8')
        const cfgMigrate = yaml.load(yamlMigrate) as Record<string, unknown>

        if (cfgMigrate.contents) {
          if (json) {
            console.log(JSON.stringify({ status: 'already_migrated', message: '이미 contents 형식입니다.' }))
          } else {
            console.error('✓ 이미 contents 형식입니다.')
          }
          return
        }

        const legacySource = cfgMigrate.source as string | undefined
        if (!legacySource) {
          if (json) {
            console.log(JSON.stringify({ status: 'no_source', message: 'source 필드가 없습니다.' }))
          } else {
            console.error('source 필드가 없습니다. relay package --init으로 초기화하세요.')
          }
          process.exit(1)
        }

        // source 디렉토리를 스캔하여 모든 항목을 contents[]로 변환
        const sourceBase = path.join(projectPath, legacySource)
        const migratedContents: ContentEntry[] = []

        if (fs.existsSync(sourceBase)) {
          const localTools = detectAgentCLIs(projectPath)
          const tool = localTools.find((t) => t.skillsDir === legacySource)
          if (tool) {
            const items = scanLocalItems(projectPath, tool)
            for (const item of items) {
              migratedContents.push({
                name: item.name,
                type: item.type,
                from: `${legacySource}/${item.relativePath}`,
              })
            }
          }
        }

        // relay.yaml에서 source 제거, contents 저장
        delete cfgMigrate.source
        cfgMigrate.contents = migratedContents
        fs.writeFileSync(relayYamlPath, yaml.dump(cfgMigrate, { lineWidth: 120 }), 'utf-8')

        if (json) {
          console.log(JSON.stringify({ status: 'migrated', contents: migratedContents }))
        } else {
          console.error(`✓ source(${legacySource}) → contents(${migratedContents.length}개 항목)로 마이그레이션 완료`)
        }
        return
      }

      // ─── 재패키징 (contents 매니페스트 기반 동기화) ───
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = yaml.load(yamlContent) as Record<string, unknown>
      const contents = (config.contents as ContentEntry[] | undefined) ?? []

      // 기존 source 필드 → contents 마이그레이션 안내
      if (!config.contents && config.source) {
        const legacySource = config.source as string
        if (json) {
          console.log(JSON.stringify({
            status: 'migration_required',
            message: `relay.yaml의 source 필드를 contents로 마이그레이션해야 합니다.`,
            legacy_source: legacySource,
          }))
        } else {
          console.error(`relay.yaml에 기존 source 필드(${legacySource})가 있습니다.`)
          console.error(`contents 형식으로 마이그레이션하려면: relay package --migrate`)
        }
        process.exit(1)
      }

      if (contents.length === 0) {
        if (json) {
          console.log(JSON.stringify({
            status: 'no_contents',
            message: 'relay.yaml에 contents가 없습니다. relay package --init으로 패키지를 초기화하세요.',
          }))
        } else {
          console.error('relay.yaml에 contents가 없습니다.')
          console.error('relay package --init으로 패키지를 초기화하세요.')
        }
        process.exit(1)
      }

      // contents 기반 diff 계산
      const { diff: contentsDiff, newItems } = computeContentsDiff(contents, relayDir, projectPath)

      const summary = {
        modified: contentsDiff.filter((d) => d.status === 'modified').length,
        unchanged: contentsDiff.filter((d) => d.status === 'unchanged').length,
        source_missing: contentsDiff.filter((d) => d.status === 'source_missing').length,
        new_available: newItems.length,
      }

      const hasChanges = summary.modified > 0

      // --sync: contents 단위 동기화
      if (opts.sync && hasChanges) {
        syncContentsToRelay(contents, contentsDiff, relayDir, projectPath)
      }

      const result: ContentsPackageResult = {
        diff: contentsDiff.filter((d) => d.status !== 'unchanged'),
        new_items: newItems,
        synced: opts.sync === true && hasChanges,
        summary,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        if (!hasChanges && newItems.length === 0 && summary.source_missing === 0) {
          console.error('✓ 모든 콘텐츠가 동기화 상태입니다.')
          return
        }

        console.error('\n📦 콘텐츠 동기화 상태\n')
        for (const entry of contentsDiff) {
          if (entry.status === 'unchanged') continue
          const icon = entry.status === 'modified' ? '  변경' : '  ⚠ 원본 없음'
          console.error(`${icon}: ${entry.name} (${entry.type})`)
          if (entry.files) {
            for (const f of entry.files) {
              console.error(`    ${f.status}: ${f.relPath}`)
            }
          }
        }

        if (newItems.length > 0) {
          console.error('\n  새로 발견된 콘텐츠:')
          for (const item of newItems) {
            console.error(`    + ${item.name} (${item.type}) — ${item.source}`)
          }
        }

        console.error('')
        console.error(`  합계: 변경 ${summary.modified}, 유지 ${summary.unchanged}, 원본 없음 ${summary.source_missing}, 신규 ${summary.new_available}`)

        if (opts.sync) {
          console.error('\n✓ .relay/에 반영 완료')
        } else if (hasChanges) {
          console.error('\n반영하려면: relay package --sync')
        }
      }
    })
}
