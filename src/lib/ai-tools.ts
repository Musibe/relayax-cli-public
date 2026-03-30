import fs from 'fs'
import os from 'os'
import path from 'path'

export interface AITool {
  name: string
  value: string
  skillsDir: string
}

/**
 * Agent Skills 표준을 지원하는 에이전트 CLI 목록.
 * @fission-ai/openspec의 AI_TOOLS에서 차용.
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
 * 프로젝트 디렉토리에서 에이전트 CLI 디렉토리를 감지한다.
 */
export function detectAgentCLIs(projectPath: string): AITool[] {
  return AI_TOOLS.filter((tool) =>
    fs.existsSync(path.join(projectPath, tool.skillsDir))
  )
}

/**
 * Cowork/sandbox 환경의 마운트 경로 후보를 반환한다.
 * /sessions/<id>/mnt/ 같은 경로에 실제 파일이 마운트됨.
 */
export function detectMountPaths(): string[] {
  const home = os.homedir()
  const mntPath = path.join(home, 'mnt')
  if (!fs.existsSync(mntPath)) return []
  return [mntPath]
}

/**
 * 마운트 경로에서 에이전트 CLI 디렉토리를 감지한다.
 */
export function detectMountedCLIs(): { tool: AITool; basePath: string }[] {
  const results: { tool: AITool; basePath: string }[] = []
  for (const mnt of detectMountPaths()) {
    for (const tool of AI_TOOLS) {
      if (fs.existsSync(path.join(mnt, tool.skillsDir))) {
        results.push({ tool, basePath: mnt })
      }
    }
  }
  return results
}

/**
 * 홈 디렉토리에서 글로벌 에이전트 CLI 디렉토리를 감지한다.
 * ~/{skillsDir}/ 가 존재하는 CLI를 반환.
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
  /** 소스 디렉토리 기준 상대 경로 (예: skills/code-review) */
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
 * 소스 디렉토리(basePath) 안의 skills/, agents/, commands/, rules/에서
 * 개별 항목을 스캔하여 반환한다.
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
        name: entry.name.replace(/\.\w+$/, ''), // 파일이면 확장자 제거
        type,
        relativePath: path.join(dir, entry.name),
      })
    }
  }
  return items
}

/**
 * 프로젝트 로컬 소스의 개별 스킬/에이전트/커맨드/룰 항목을 반환한다.
 */
export function scanLocalItems(projectPath: string, tool: AITool): ContentItem[] {
  const basePath = path.join(projectPath, tool.skillsDir)
  return scanItemsIn(basePath)
}

/**
 * 글로벌 홈 디렉토리 소스의 개별 스킬/에이전트/커맨드/룰 항목을 반환한다.
 */
export function scanGlobalItems(tool: AITool, home?: string): ContentItem[] {
  const basePath = path.join(home ?? os.homedir(), tool.skillsDir)
  return scanItemsIn(basePath)
}

/**
 * 마운트 경로의 개별 스킬/에이전트/커맨드/룰 항목을 반환한다.
 */
export function scanMountedItems(basePath: string, tool: AITool): ContentItem[] {
  return scanItemsIn(path.join(basePath, tool.skillsDir))
}
