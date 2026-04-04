import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { detectGlobalCLIs, detectAgentCLIs } from './ai-tools.js'
import type { Requires, RequiresEnv, RequiresMcp } from '../commands/publish.js'

const COPY_DIRS = ['skills', 'agents', 'rules', 'commands'] as const
const SYMLINK_DIRS = ['skills', 'commands', 'agents', 'rules'] as const

// ─── Symlink Deployment ───

export interface DeployResult {
  symlinks: string[]
  warnings: string[]
}

/**
 * agentDir 내 skills/, commands/, agents/, rules/ 하위 항목을
 * 감지된 AI tool의 skillsDir에 symlink로 생성한다.
 *
 * @param agentDir  .relay/agents/<owner>/<name>/ 경로
 * @param slug      @owner/name 형태
 * @param scope     'global' | 'local'
 * @param projectPath  프로젝트 루트 경로 (local scope 시 사용)
 */
export function deploySymlinks(
  agentDir: string,
  scope: 'global' | 'local',
  projectPath: string,
): DeployResult {
  const result: DeployResult = { symlinks: [], warnings: [] }

  // 감지된 AI tool 목록
  const tools = scope === 'global'
    ? detectGlobalCLIs()
    : detectAgentCLIs(projectPath)

  // Claude Code를 기본으로 포함 (글로벌에 .claude/가 없어도 생성)
  if (scope === 'global') {
    const hasClaudeCode = tools.some((t) => t.value === 'claude')
    if (!hasClaudeCode) {
      tools.push({ name: 'Claude Code', value: 'claude', skillsDir: '.claude' })
    }
  }

  for (const tool of tools) {
    const baseDir = scope === 'global'
      ? path.join(os.homedir(), tool.skillsDir)
      : path.join(projectPath, tool.skillsDir)

    for (const dir of SYMLINK_DIRS) {
      const srcDir = path.join(agentDir, dir)
      if (!fs.existsSync(srcDir)) continue

      const entries = fs.readdirSync(srcDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const srcPath = path.join(srcDir, entry.name)
        const destDir = path.join(baseDir, dir)
        const destPath = path.join(destDir, entry.name)

        // 대상 디렉토리 생성
        fs.mkdirSync(destDir, { recursive: true })

        // 충돌 처리
        if (fs.existsSync(destPath) || isSymlink(destPath)) {
          if (isSymlink(destPath)) {
            const existingTarget = fs.readlinkSync(destPath)
            if (!existingTarget.includes('.relay/agents/') || existingTarget.startsWith(agentDir)) {
              // 같은 에이전트 또는 relay가 아닌 symlink → 조용히 교체
            } else {
              // 다른 에이전트의 symlink → 경고
              result.warnings.push(`⚠ ${dir}/${entry.name} 가 다른 에이전트에서 교체됩니다`)
            }
            fs.unlinkSync(destPath)
          } else {
            // 일반 파일/디렉토리 → 보호, 건너뜀
            result.warnings.push(`⚠ ${destPath} 는 사용자 파일이므로 건너뜁니다`)
            continue
          }
        }

        fs.symlinkSync(srcPath, destPath)
        result.symlinks.push(destPath)
      }
    }
  }

  return result
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * symlink 목록을 기반으로 symlink를 제거한다.
 */
export function removeSymlinks(symlinks: string[]): string[] {
  const removed: string[] = []
  for (const link of symlinks) {
    try {
      if (isSymlink(link)) {
        fs.unlinkSync(link)
        removed.push(link)
      } else if (fs.existsSync(link)) {
        // symlink이 아닌 파일이면 건너뜀 (사용자 파일 보호)
      }
    } catch {
      // best-effort
    }
  }
  return removed
}

// ─── Requires Check ───

interface RequiresCheckResult {
  label: string
  status: 'ok' | 'warn' | 'missing'
  message: string
}

/**
 * agentDir의 relay.yaml에서 requires를 읽고 체크 결과를 반환한다.
 */
export function checkRequires(agentDir: string): RequiresCheckResult[] {
  const results: RequiresCheckResult[] = []

  const yamlPath = path.join(agentDir, 'relay.yaml')
  if (!fs.existsSync(yamlPath)) return results

  let requires: Requires | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml') as { load: (s: string) => unknown }
    const raw = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown> | null
    requires = (raw?.requires ?? undefined) as Requires | undefined
  } catch {
    return results
  }

  if (!requires) return results

  // runtime
  if (requires.runtime?.node) {
    const ver = getCommandOutput('node --version')
    if (ver) {
      const clean = ver.replace(/^v/, '')
      const required = requires.runtime.node.replace(/^>=?\s*/, '')
      const ok = compareVersions(clean, required) >= 0
      results.push({
        label: 'runtime',
        status: ok ? 'ok' : 'warn',
        message: ok
          ? `Node.js >=${required} — ${ver} 확인됨`
          : `Node.js >=${required} — ${ver} (업그레이드 필요)`,
      })
    }
  }
  if (requires.runtime?.python) {
    const ver = getCommandOutput('python3 --version')
    if (ver) {
      const clean = ver.replace(/^Python\s*/, '')
      const required = requires.runtime.python.replace(/^>=?\s*/, '')
      const ok = compareVersions(clean, required) >= 0
      results.push({
        label: 'runtime',
        status: ok ? 'ok' : 'warn',
        message: ok
          ? `Python >=${required} — ${clean} 확인됨`
          : `Python >=${required} — ${clean} (업그레이드 필요)`,
      })
    }
  }

  // cli
  if (requires.cli) {
    for (const cli of requires.cli) {
      if (!isSafeName(cli.name)) continue
      const found = getCommandOutput('which', [cli.name])
      if (found) {
        results.push({ label: 'cli', status: 'ok', message: `${cli.name} — 설치됨` })
      } else {
        const installHint = cli.install ? ` → ${cli.install}` : ''
        results.push({
          label: 'cli',
          status: cli.required !== false ? 'missing' : 'warn',
          message: `${cli.name} — 미설치${installHint}`,
        })
      }
    }
  }

  // env
  if (requires.env) {
    for (const env of requires.env as RequiresEnv[]) {
      const val = process.env[env.name]
      if (val) {
        results.push({ label: 'env', status: 'ok', message: `${env.name} — 설정됨` })
      } else {
        const desc = env.description ? ` (${env.description})` : ''
        const hint = env.setup_hint ? `\n    설정 방법:\n${env.setup_hint.split('\n').map((l: string) => `      ${l}`).join('\n')}` : ''
        results.push({
          label: 'env',
          status: env.required !== false ? 'missing' : 'warn',
          message: `${env.name} — 미설정${desc}${hint}`,
        })
      }
    }
  }

  // npm
  if (requires.npm) {
    for (const pkg of requires.npm) {
      const name = typeof pkg === 'string' ? pkg : pkg.name
      const isRequired = typeof pkg === 'string' ? true : pkg.required !== false
      if (!isSafeName(name)) continue
      const found = getCommandOutput('npm', ['list', name])
      const installed = found ? !found.includes('(empty)') && !found.includes('ERR') : false
      if (installed) {
        results.push({ label: 'npm', status: 'ok', message: `${name} — 설치됨` })
      } else {
        results.push({
          label: 'npm',
          status: isRequired ? 'missing' : 'warn',
          message: `${name} — 미설치`,
        })
      }
    }
  }

  // mcp
  if (requires.mcp) {
    for (const mcp of requires.mcp as RequiresMcp[]) {
      const configStr = mcp.config
        ? JSON.stringify(mcp.config, null, 2)
        : mcp.package ?? mcp.name
      results.push({
        label: 'mcp',
        status: 'warn',
        message: `${mcp.name} MCP — 설정 필요: ${configStr}`,
      })
    }
  }

  return results
}

/**
 * requires 체크 결과를 콘솔에 출력한다.
 */
export function printRequiresCheck(results: RequiresCheckResult[]): void {
  if (results.length === 0) return

  console.log('\n\x1b[1m📋 Requirements\x1b[0m')
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️ ' : '❌'
    console.log(`  ${icon} ${r.message}`)
  }

  const hasMissing = results.some((r) => r.status === 'missing')
  if (hasMissing) {
    console.log('\n  \x1b[33m⚠️  필수 요구사항이 충족되지 않았습니다. 에이전트 기능이 제한될 수 있습니다.\x1b[0m')
  }
}

function getCommandOutput(cmd: string, args: string[] = []): string | null {
  try {
    const full = args.length > 0 ? `${cmd} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}` : cmd
    return execSync(full, { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return null
  }
}

/** relay.yaml에서 온 이름이 안전한 식별자인지 확인 */
function isSafeName(name: string): boolean {
  return /^[a-zA-Z0-9._@/-]+$/.test(name)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

function copyDirRecursive(src: string, dest: string): string[] {
  const copiedFiles: string[] = []
  if (!fs.existsSync(src)) return copiedFiles

  fs.mkdirSync(dest, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copiedFiles.push(...copyDirRecursive(srcPath, destPath))
    } else {
      fs.copyFileSync(srcPath, destPath)
      copiedFiles.push(destPath)
    }
  }
  return copiedFiles
}

export function installAgent(
  extractedDir: string,
  installPath: string
): string[] {
  const installedFiles: string[] = []

  for (const dir of COPY_DIRS) {
    const srcDir = path.join(extractedDir, dir)
    const destDir = path.join(installPath, dir)
    installedFiles.push(...copyDirRecursive(srcDir, destDir))
  }

  return installedFiles
}

export function uninstallAgent(files: string[]): string[] {
  const removed: string[] = []
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue
      const stat = fs.statSync(file)
      if (stat.isDirectory()) {
        fs.rmSync(file, { recursive: true, force: true })
      } else {
        fs.unlinkSync(file)
      }
      removed.push(file)
    } catch {
      // best-effort removal
    }
  }
  return removed
}

/**
 * 빈 상위 디렉토리를 boundary까지 정리한다.
 * 예: /home/.claude/skills/cardnews/ 가 비었으면 삭제, /home/.claude/skills/는 유지
 */
export function cleanEmptyParents(filePath: string, boundary: string): void {
  let dir = path.dirname(filePath)
  while (dir.length > boundary.length && dir.startsWith(boundary)) {
    try {
      const entries = fs.readdirSync(dir)
      if (entries.length > 0) break
      fs.rmdirSync(dir)
      dir = path.dirname(dir)
    } catch {
      break
    }
  }
}
