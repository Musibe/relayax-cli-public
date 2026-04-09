import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { detectGlobalCLIs, detectAgentCLIs, AI_TOOLS } from './ai-tools.js'
import type { AITool } from './ai-tools.js'
import type { Requires, RequiresEnv, RequiresMcp } from '../commands/publish.js'

const COPY_DIRS = ['skills', 'agents', 'rules', 'commands'] as const
const SYMLINK_DIRS = ['skills', 'commands', 'agents', 'rules'] as const

// ─── Symlink Deployment ───

export interface DeployResult {
  symlinks: string[]
  warnings: string[]
}

/**
 * Create symlinks from skills/, commands/, agents/, rules/ under agentDir
 * to detected AI tool skillsDir directories.
 *
 * @param agentDir  .relay/agents/<owner>/<name>/ path
 * @param slug      @owner/name format
 * @param scope     'global' | 'local'
 * @param projectPath  Project root path (used for local scope)
 */
export async function deploySymlinks(
  agentDir: string,
  scope: 'global' | 'local',
  projectPath: string,
  overrideTools?: AITool[],
): Promise<DeployResult> {
  const result: DeployResult = { symlinks: [], warnings: [] }

  let tools: AITool[]
  if (overrideTools) {
    tools = overrideTools
  } else {
    tools = scope === 'global'
      ? detectGlobalCLIs()
      : detectAgentCLIs(projectPath)

    if (scope === 'global' && !tools.some((t) => t.value === 'claude')) {
      tools.push({ name: 'Claude Code', value: 'claude', skillsDir: '.claude' })
    }

    if (scope === 'local' && tools.length === 0) {
      if (process.stdout.isTTY) {
        const { checkbox } = await import('@inquirer/prompts')
        tools = await checkbox<AITool>({
          message: `Select tools to set up (${AI_TOOLS.length} available)`,
          choices: AI_TOOLS.map((t) => ({ name: t.name, value: t })),
        })
      } else {
        tools = [{ name: 'Claude Code', value: 'claude', skillsDir: '.claude' }]
      }
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

        // Create target directory
        fs.mkdirSync(destDir, { recursive: true })

        // Conflict handling
        if (fs.existsSync(destPath) || isSymlink(destPath)) {
          if (isSymlink(destPath)) {
            const existingTarget = fs.readlinkSync(destPath)
            if (!existingTarget.includes('.anpm/agents/') || existingTarget.startsWith(agentDir)) {
              // Same agent or non-relay symlink — silently replace
            } else {
              // Symlink from another agent — warn
              result.warnings.push(`⚠ ${dir}/${entry.name} is being replaced from another agent`)
            }
            fs.unlinkSync(destPath)
          } else {
            // Regular file/directory — protect, skip
            result.warnings.push(`⚠ ${destPath} is a user file, skipping`)
            continue
          }
        }

        const relativeSrc = path.relative(path.dirname(destPath), srcPath)
        fs.symlinkSync(relativeSrc, destPath)
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
 * Remove symlinks based on a list of symlink paths.
 */
export function removeSymlinks(symlinks: string[]): string[] {
  const removed: string[] = []
  for (const link of symlinks) {
    try {
      if (isSymlink(link)) {
        fs.unlinkSync(link)
        removed.push(link)
      } else if (fs.existsSync(link)) {
        // Not a symlink — skip (protect user files)
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
 * Read requires from relay.yaml in agentDir and return check results.
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
          ? `Node.js >=${required} — ${ver} found`
          : `Node.js >=${required} — ${ver} (upgrade required)`,
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
          ? `Python >=${required} — ${clean} found`
          : `Python >=${required} — ${clean} (upgrade required)`,
      })
    }
  }

  // cli
  if (requires.cli) {
    for (const cli of requires.cli) {
      if (!isSafeName(cli.name)) continue
      const found = getCommandOutput('which', [cli.name])
      if (found) {
        results.push({ label: 'cli', status: 'ok', message: `${cli.name} — installed` })
      } else {
        const installHint = cli.install ? ` → ${cli.install}` : ''
        results.push({
          label: 'cli',
          status: cli.required !== false ? 'missing' : 'warn',
          message: `${cli.name} — not installed${installHint}`,
        })
      }
    }
  }

  // env
  if (requires.env) {
    for (const env of requires.env as RequiresEnv[]) {
      const val = process.env[env.name]
      if (val) {
        results.push({ label: 'env', status: 'ok', message: `${env.name} — set` })
      } else {
        const desc = env.description ? ` (${env.description})` : ''
        const hint = env.setup_hint ? `\n    Setup:\n${env.setup_hint.split('\n').map((l: string) => `      ${l}`).join('\n')}` : ''
        results.push({
          label: 'env',
          status: env.required !== false ? 'missing' : 'warn',
          message: `${env.name} — not set${desc}${hint}`,
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
        results.push({ label: 'npm', status: 'ok', message: `${name} — installed` })
      } else {
        results.push({
          label: 'npm',
          status: isRequired ? 'missing' : 'warn',
          message: `${name} — not installed`,
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
        message: `${mcp.name} MCP — setup required: ${configStr}`,
      })
    }
  }

  return results
}

/**
 * Print requires check results to console.
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
    console.log('\n  \x1b[33m⚠️  Required dependencies not met. Some agent features may not work.\x1b[0m')
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

/** Check if a name from relay.yaml is a safe identifier */
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
 * Clean up empty parent directories up to boundary.
 * e.g., remove /home/.claude/skills/cardnews/ if empty, keep /home/.claude/skills/
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
