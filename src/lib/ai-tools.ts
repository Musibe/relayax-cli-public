import fs from 'fs'
import os from 'os'
import path from 'path'

export interface AITool {
  name: string
  value: string
  skillsDir: string
}

/**
 * List of agent CLIs that support the Agent Skills standard.
 * Derived from @fission-ai/openspec's AI_TOOLS.
 */
export const AI_TOOLS: AITool[] = [
  { name: 'Amazon Q Developer', value: 'amazon-q', skillsDir: '.amazonq' },
  { name: 'Antigravity', value: 'antigravity', skillsDir: '.agent' },
  { name: 'Auggie', value: 'auggie', skillsDir: '.augment' },
  { name: 'Claude Code', value: 'claude', skillsDir: '.claude' },
  { name: 'Cline', value: 'cline', skillsDir: '.cline' },
  { name: 'Codex', value: 'codex', skillsDir: '.codex' },
  { name: 'CodeBuddy', value: 'codebuddy', skillsDir: '.codebuddy' },
  { name: 'Continue', value: 'continue', skillsDir: '.continue' },
  { name: 'CoStrict', value: 'costrict', skillsDir: '.cospec' },
  { name: 'Crush', value: 'crush', skillsDir: '.crush' },
  { name: 'Cursor', value: 'cursor', skillsDir: '.cursor' },
  { name: 'Factory Droid', value: 'factory', skillsDir: '.factory' },
  { name: 'Gemini CLI', value: 'gemini', skillsDir: '.gemini' },
  { name: 'GitHub Copilot', value: 'github-copilot', skillsDir: '.github' },
  { name: 'Hermes Agent', value: 'hermes', skillsDir: '.hermes' },
  { name: 'iFlow', value: 'iflow', skillsDir: '.iflow' },
  { name: 'Kilo Code', value: 'kilocode', skillsDir: '.kilocode' },
  { name: 'Kiro', value: 'kiro', skillsDir: '.kiro' },
  { name: 'OpenClaw', value: 'openclaw', skillsDir: '.openclaw' },
  { name: 'OpenCode', value: 'opencode', skillsDir: '.opencode' },
  { name: 'Pi', value: 'pi', skillsDir: '.pi' },
  { name: 'Qoder', value: 'qoder', skillsDir: '.qoder' },
  { name: 'Qwen Code', value: 'qwen', skillsDir: '.qwen' },
  { name: 'RooCode', value: 'roocode', skillsDir: '.roo' },
  { name: 'Trae', value: 'trae', skillsDir: '.trae' },
  { name: 'Windsurf', value: 'windsurf', skillsDir: '.windsurf' },
]

/**
 * Detect agent CLI directories in a project directory.
 */
export function detectAgentCLIs(projectPath: string): AITool[] {
  return AI_TOOLS.filter((tool) =>
    fs.existsSync(path.join(projectPath, tool.skillsDir))
  )
}

/**
 * Detect global agent CLI directories in the home directory.
 * Returns CLIs where ~/{skillsDir}/ exists.
 */
export function detectGlobalCLIs(home?: string): AITool[] {
  const homeDir = home ?? os.homedir()
  return AI_TOOLS.filter((tool) =>
    fs.existsSync(path.join(homeDir, tool.skillsDir))
  )
}

// ─── Content Item Types ───

export type ContentType = 'skill' | 'agent' | 'command' | 'rule'

export interface ContentItem {
  name: string
  type: ContentType
  /** Relative path from source directory (e.g., skills/code-review) */
  relativePath: string
}

const CONTENT_DIRS: { dir: string; type: ContentType }[] = [
  { dir: 'skills', type: 'skill' },
  { dir: 'agents', type: 'agent' },
  { dir: 'commands', type: 'command' },
  { dir: 'rules', type: 'rule' },
]

const EXCLUDE_SUBDIRS = ['relay']

/**
 * Scan skills/, agents/, commands/, rules/ inside the source directory (basePath)
 * and return individual items.
 */
function scanItemsIn(basePath: string): ContentItem[] {
  const items: ContentItem[] = []
  for (const { dir, type } of CONTENT_DIRS) {
    const fullDir = path.join(basePath, dir)
    if (!fs.existsSync(fullDir)) continue

    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && EXCLUDE_SUBDIRS.includes(entry.name)) continue

      items.push({
        name: entry.name.replace(/\.\w+$/, ''), // strip extension for files
        type,
        relativePath: path.join(dir, entry.name),
      })
    }
  }
  return items
}

/**
 * Return individual skill/agent/command/rule items from a project local source.
 */
export function scanLocalItems(projectPath: string, tool: AITool): ContentItem[] {
  const basePath = path.join(projectPath, tool.skillsDir)
  return scanItemsIn(basePath)
}

/**
 * Return individual skill/agent/command/rule items from the global home directory source.
 */
export function scanGlobalItems(tool: AITool, home?: string): ContentItem[] {
  const basePath = path.join(home ?? os.homedir(), tool.skillsDir)
  return scanItemsIn(basePath)
}

