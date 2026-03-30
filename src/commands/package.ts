import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Command } from 'commander'
import yaml from 'js-yaml'
import { detectAgentCLIs, type AITool } from '../lib/ai-tools.js'

const SYNC_DIRS = ['skills', 'commands', 'agents', 'rules'] as const
const EXCLUDE_SUBDIRS = ['relay'] // relay CLI 전용 하위 디렉토리 제외

// ─── Types ───

interface FileEntry {
  /** .relay/ 기준 상대 경로 (예: skills/my-skill/SKILL.md) */
  relPath: string
  hash: string
}

interface SourceScanResult {
  tool: AITool
  files: FileEntry[]
  summary: Record<string, number> // dir → count (예: { skills: 2, commands: 3 })
}

type DiffStatus = 'added' | 'modified' | 'deleted' | 'unchanged'

interface DiffEntry {
  relPath: string
  status: DiffStatus
}

interface PackageResult {
  source: string
  sourceName: string
  synced: boolean
  diff: DiffEntry[]
  summary: {
    added: number
    modified: number
    deleted: number
    unchanged: number
  }
}

// ─── Helpers ───

function fileHash(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * 디렉토리를 재귀 탐색하여 파일 목록을 반환한다.
 * baseDir 기준 상대 경로 + 해시.
 */
function scanDir(baseDir: string, subDir: string): FileEntry[] {
  const fullDir = path.join(baseDir, subDir)
  if (!fs.existsSync(fullDir)) return []

  const entries: FileEntry[] = []

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else {
        const relPath = path.relative(baseDir, fullPath)
        entries.push({ relPath, hash: fileHash(fullPath) })
      }
    }
  }

  walk(fullDir)
  return entries
}

/**
 * 소스 디렉토리(예: .claude/)에서 배포 가능한 콘텐츠를 스캔한다.
 * relay/ 하위 디렉토리는 제외.
 */
function scanSource(projectPath: string, tool: AITool): SourceScanResult {
  const sourceBase = path.join(projectPath, tool.skillsDir)
  const files: FileEntry[] = []
  const summary: Record<string, number> = {}

  for (const dir of SYNC_DIRS) {
    const fullDir = path.join(sourceBase, dir)
    if (!fs.existsSync(fullDir)) continue

    // 제외 대상 필터링 (예: commands/relay/)
    const dirEntries = fs.readdirSync(fullDir, { withFileTypes: true })
    let count = 0

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && EXCLUDE_SUBDIRS.includes(entry.name)) continue

      const entryPath = path.join(fullDir, entry.name)
      if (entry.isDirectory()) {
        // 하위 파일 재귀 탐색
        const subFiles = scanDir(sourceBase, path.join(dir, entry.name))
        // relPath를 sourceBase 기준 → SYNC_DIRS 기준으로 유지
        files.push(...subFiles)
        count += subFiles.length > 0 ? 1 : 0 // 디렉토리 단위로 카운트
      } else {
        const relPath = path.relative(sourceBase, entryPath)
        files.push({ relPath, hash: fileHash(entryPath) })
        count++
      }
    }

    if (count > 0) summary[dir] = count
  }

  return { tool, files, summary }
}

/**
 * .relay/ 디렉토리의 현재 콘텐츠를 스캔한다.
 */
function scanRelay(relayDir: string): FileEntry[] {
  const files: FileEntry[] = []
  for (const dir of SYNC_DIRS) {
    files.push(...scanDir(relayDir, dir))
  }
  return files
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

// ─── Command ───

export function registerPackage(program: Command): void {
  program
    .command('package')
    .description('소스 디렉토리에서 .relay/로 콘텐츠를 동기화합니다')
    .option('--source <dir>', '소스 디렉토리 지정 (예: .claude)')
    .option('--sync', '변경사항을 .relay/에 즉시 반영', false)
    .option('--init', '최초 패키징: 소스 감지 → .relay/ 초기화', false)
    .action(async (opts: { source?: string; sync?: boolean; init?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = process.cwd()
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')

      // ─── 최초 패키징 (--init) ───
      if (opts.init || !fs.existsSync(relayYamlPath)) {
        const detected = detectAgentCLIs(projectPath)

        // 각 도구의 콘텐츠 스캔
        const scans = detected
          .map((tool) => scanSource(projectPath, tool))
          .filter((s) => s.files.length > 0)

        if (json) {
          console.log(JSON.stringify({
            status: 'init_required',
            detected: scans.map((s) => ({
              source: s.tool.skillsDir,
              name: s.tool.name,
              summary: s.summary,
              fileCount: s.files.length,
            })),
          }))
        } else {
          if (scans.length === 0) {
            console.error('배포 가능한 에이전트 콘텐츠를 찾지 못했습니다.')
            console.error('skills/, commands/, agents/, rules/ 중 하나를 만들어주세요.')
            process.exit(1)
          }

          console.error('\n프로젝트에서 발견된 에이전트 콘텐츠:\n')
          for (const scan of scans) {
            const parts = Object.entries(scan.summary)
              .map(([dir, count]) => `${dir} ${count}개`)
              .join(', ')
            console.error(`  📁 ${scan.tool.skillsDir}/ — ${parts}`)
          }
          console.error('')
        }
        return
      }

      // ─── 재패키징 (source 기반 동기화) ───
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = yaml.load(yamlContent) as Record<string, unknown>
      const source = opts.source ?? (config.source as string | undefined)

      if (!source) {
        if (json) {
          console.log(JSON.stringify({
            status: 'no_source',
            message: 'relay.yaml에 source 필드가 없습니다. --source 옵션으로 지정하거나 relay.yaml에 source를 추가하세요.',
          }))
        } else {
          console.error('relay.yaml에 source 필드가 없습니다.')
          console.error('--source <dir> 옵션으로 지정하거나 relay.yaml에 source를 추가하세요.')
        }
        process.exit(1)
      }

      // 소스 디렉토리 존재 확인
      const sourceBase = path.join(projectPath, source)
      if (!fs.existsSync(sourceBase)) {
        const msg = `소스 디렉토리 '${source}'를 찾을 수 없습니다.`
        if (json) {
          console.log(JSON.stringify({ error: 'SOURCE_NOT_FOUND', message: msg }))
        } else {
          console.error(msg)
        }
        process.exit(1)
      }

      // 소스에서 해당 도구 찾기
      const allTools = detectAgentCLIs(projectPath)
      const tool = allTools.find((t) => t.skillsDir === source)
      const toolName = tool?.name ?? source

      // diff 계산
      const sourceScan = tool
        ? scanSource(projectPath, tool)
        : { tool: { name: source, value: source, skillsDir: source } as AITool, files: [], summary: {} }

      // tool이 없으면 직접 스캔
      if (!tool) {
        for (const dir of SYNC_DIRS) {
          const files = scanDir(sourceBase, dir)
          sourceScan.files.push(...files)
          if (files.length > 0) sourceScan.summary[dir] = files.length
        }
      }

      const relayFiles = scanRelay(relayDir)
      const diff = computeDiff(sourceScan.files, relayFiles)

      const summary = {
        added: diff.filter((d) => d.status === 'added').length,
        modified: diff.filter((d) => d.status === 'modified').length,
        deleted: diff.filter((d) => d.status === 'deleted').length,
        unchanged: diff.filter((d) => d.status === 'unchanged').length,
      }

      const hasChanges = summary.added + summary.modified + summary.deleted > 0

      // --sync: 즉시 동기화
      if (opts.sync && hasChanges) {
        syncToRelay(sourceBase, relayDir, diff)
      }

      const result: PackageResult = {
        source,
        sourceName: toolName,
        synced: opts.sync === true && hasChanges,
        diff: diff.filter((d) => d.status !== 'unchanged'),
        summary,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        if (!hasChanges) {
          console.error(`✓ 소스(${source})와 .relay/가 동기화 상태입니다.`)
          return
        }

        console.error(`\n📦 소스 동기화 (${source}/ → .relay/)\n`)
        for (const entry of diff) {
          if (entry.status === 'unchanged') continue
          const icon = entry.status === 'added' ? '  신규' : entry.status === 'modified' ? '  변경' : '  삭제'
          console.error(`${icon}: ${entry.relPath}`)
        }
        console.error('')
        console.error(`  합계: 신규 ${summary.added}, 변경 ${summary.modified}, 삭제 ${summary.deleted}, 유지 ${summary.unchanged}`)

        if (opts.sync) {
          console.error(`\n✓ .relay/에 반영 완료`)
        } else {
          console.error(`\n반영하려면: relay package --sync`)
        }
      }
    })
}
