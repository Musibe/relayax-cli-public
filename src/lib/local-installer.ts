import fs from 'fs'
import path from 'path'
import os from 'os'
import { detectAgentStructure, hasDetectedContent } from './auto-detect.js'

export interface LocalInstallResult {
  agentDir: string
  name: string
  detected: ReturnType<typeof detectAgentStructure>
}

const COPY_DIRS = ['skills', 'agents', 'rules', 'commands'] as const

/**
 * Install an agent from a local directory path.
 * Copies content to .relay/agents/local/<name>/.
 */
export function installFromLocal(
  sourcePath: string,
  opts: { scope: 'global' | 'local'; projectPath: string; name?: string },
): LocalInstallResult {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Path not found: ${sourcePath}`)
  }

  const stat = fs.statSync(sourcePath)
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${sourcePath}`)
  }

  const detected = detectAgentStructure(sourcePath)
  if (!hasDetectedContent(detected)) {
    throw new Error(
      'No agent structure detected. Add a relay.yaml to define your agent, ' +
      'or ensure the directory contains skills/, commands/, or rules/.'
    )
  }

  const name = opts.name ?? path.basename(sourcePath)
  const baseDir = opts.scope === 'global'
    ? path.join(os.homedir(), '.relay', 'agents', 'local', name)
    : path.join(opts.projectPath, '.relay', 'agents', 'local', name)

  // Clean existing install
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
  fs.mkdirSync(baseDir, { recursive: true })

  // Copy content from detected root
  const contentRoot = detected.root
  for (const dir of COPY_DIRS) {
    const srcDir = path.join(contentRoot, dir)
    if (!fs.existsSync(srcDir)) continue
    copyDirRecursive(srcDir, path.join(baseDir, dir))
  }

  // Copy relay.yaml if exists
  const yamlSrc = path.join(sourcePath, 'relay.yaml')
  if (fs.existsSync(yamlSrc)) {
    fs.copyFileSync(yamlSrc, path.join(baseDir, 'relay.yaml'))
  }

  // For single-file detection (AGENTS.md only), wrap into skills/<name>/
  if (detected.method === 'single-file') {
    const skillDir = path.join(baseDir, 'skills', name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.copyFileSync(path.join(sourcePath, 'AGENTS.md'), path.join(skillDir, 'AGENTS.md'))
  }

  return { agentDir: baseDir, name, detected }
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
