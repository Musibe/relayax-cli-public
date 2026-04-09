import fs from 'fs'
import path from 'path'
import { AI_TOOLS } from './ai-tools.js'

export interface DetectedStructure {
  /** Root directory containing the agent content */
  root: string
  /** Detected content directories relative to root */
  skills: string[]
  commands: string[]
  rules: string[]
  agents: string[]
  /** How the structure was detected */
  method: 'anpm-yaml' | 'relay-yaml' | 'standard-dirs' | 'harness-dirs' | 'single-file' | 'none'
}

const CONTENT_DIRS = ['skills', 'commands', 'rules', 'agents'] as const

/**
 * Detect agent structure in a directory, even without relay.yaml.
 *
 * Priority:
 * 1. relay.yaml exists → use as-is
 * 2. skills/, commands/, rules/, agents/ exist → standard layout
 * 3. .claude/skills/, .cursor/skills/ etc → harness-specific layout
 * 4. Root has AGENTS.md → wrap as single skill
 * 5. None detected
 */
export function detectAgentStructure(dir: string): DetectedStructure {
  const result: DetectedStructure = {
    root: dir,
    skills: [],
    commands: [],
    rules: [],
    agents: [],
    method: 'none',
  }

  // 1. anpm.yaml exists
  if (fs.existsSync(path.join(dir, 'anpm.yaml')) || fs.existsSync(path.join(dir, '.anpm', 'anpm.yaml'))) {
    result.method = 'anpm-yaml'
    for (const d of CONTENT_DIRS) {
      const fullPath = path.join(dir, d)
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        result[d] = listSubdirs(fullPath)
      }
    }
    return result
  }

  // 2. Standard dirs (skills/, commands/, rules/, agents/)
  const hasStandardDirs = CONTENT_DIRS.some((d) =>
    fs.existsSync(path.join(dir, d)) && fs.statSync(path.join(dir, d)).isDirectory()
  )
  if (hasStandardDirs) {
    result.method = 'standard-dirs'
    for (const d of CONTENT_DIRS) {
      const fullPath = path.join(dir, d)
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        result[d] = listSubdirs(fullPath)
      }
    }
    return result
  }

  // 3. Harness-specific dirs (.claude/skills/, .cursor/skills/, etc.)
  for (const tool of AI_TOOLS) {
    const harnessDir = path.join(dir, tool.skillsDir)
    if (!fs.existsSync(harnessDir)) continue
    for (const d of CONTENT_DIRS) {
      const fullPath = path.join(harnessDir, d)
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        result.root = harnessDir
        result.method = 'harness-dirs'
        result[d] = listSubdirs(fullPath)
      }
    }
    if (result.method === 'harness-dirs') return result
  }

  // 4. Single AGENTS.md at root
  if (fs.existsSync(path.join(dir, 'AGENTS.md'))) {
    result.method = 'single-file'
    result.skills = [path.basename(dir)]
    return result
  }

  return result
}

function listSubdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Format detected structure for display.
 */
export function formatDetectedStructure(detected: DetectedStructure): string {
  const lines: string[] = []
  if (detected.skills.length > 0) lines.push(`  skills: ${detected.skills.join(', ')}`)
  if (detected.commands.length > 0) lines.push(`  commands: ${detected.commands.join(', ')}`)
  if (detected.rules.length > 0) lines.push(`  rules: ${detected.rules.join(', ')}`)
  if (detected.agents.length > 0) lines.push(`  agents: ${detected.agents.join(', ')}`)
  return lines.join('\n')
}

/**
 * Check if any content was detected.
 */
export function hasDetectedContent(detected: DetectedStructure): boolean {
  return detected.skills.length > 0 ||
    detected.commands.length > 0 ||
    detected.rules.length > 0 ||
    detected.agents.length > 0
}
