import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { checkGitInstalled } from './git-operations.js'
import { detectAgentStructure, hasDetectedContent } from './auto-detect.js'
import type { GitSource } from './install-source.js'

export interface GitInstallResult {
  agentDir: string
  slug: string
  detected: ReturnType<typeof detectAgentStructure>
}

const COPY_DIRS = ['skills', 'agents', 'rules', 'commands'] as const

/**
 * Install an agent from a git URL.
 * Shallow clones to temp, extracts agent content, copies to .relay/agents/<user>/<repo>/.
 */
export function installFromGit(
  source: GitSource,
  opts: { scope: 'global' | 'local'; projectPath: string; subpath?: string },
): GitInstallResult {
  checkGitInstalled()

  const slug = `${source.user}/${source.repo}`
  const baseDir = opts.scope === 'global'
    ? path.join(os.homedir(), '.relay', 'agents', source.user, source.repo)
    : path.join(opts.projectPath, '.relay', 'agents', source.user, source.repo)

  // Clone to temp
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-git-'))
  try {
    const cloneArgs = ['clone', '--depth', '1']
    if (source.ref) {
      cloneArgs.push('--branch', source.ref)
    }
    cloneArgs.push(source.url, tempDir)

    execFileSync('git', cloneArgs, {
      stdio: 'pipe',
      timeout: 60000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    })

    // Determine content root (subpath or repo root)
    const contentRoot = opts.subpath
      ? path.join(tempDir, opts.subpath)
      : tempDir

    if (!fs.existsSync(contentRoot)) {
      throw new Error(`Subpath not found in repository: ${opts.subpath}`)
    }

    const detected = detectAgentStructure(contentRoot)
    if (!hasDetectedContent(detected)) {
      throw new Error(
        `No agent structure detected in ${source.url}. ` +
        'Ensure the repository contains skills/, commands/, rules/, or a relay.yaml.'
      )
    }

    // Clean existing install
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true })
    }
    fs.mkdirSync(baseDir, { recursive: true })

    // Copy content from detected root
    const sourceRoot = detected.root
    for (const dir of COPY_DIRS) {
      const srcDir = path.join(sourceRoot, dir)
      if (!fs.existsSync(srcDir)) continue
      copyDirRecursive(srcDir, path.join(baseDir, dir))
    }

    // Copy relay.yaml if exists
    const yamlSrc = path.join(contentRoot, 'relay.yaml')
    if (fs.existsSync(yamlSrc)) {
      fs.copyFileSync(yamlSrc, path.join(baseDir, 'relay.yaml'))
    }

    // For single-file detection (AGENTS.md only)
    if (detected.method === 'single-file') {
      const name = source.repo
      const skillDir = path.join(baseDir, 'skills', name)
      fs.mkdirSync(skillDir, { recursive: true })
      fs.copyFileSync(path.join(contentRoot, 'AGENTS.md'), path.join(skillDir, 'AGENTS.md'))
    }

    return { agentDir: baseDir, slug, detected }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
