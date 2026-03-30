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
  { name: 'iFlow', value: 'iflow', skillsDir: '.iflow' },
  { name: 'Kilo Code', value: 'kilocode', skillsDir: '.kilocode' },
  { name: 'Kiro', value: 'kiro', skillsDir: '.kiro' },
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
 * 홈 디렉토리에서 글로벌 에이전트 CLI 디렉토리를 감지한다.
 * ~/{skillsDir}/ 가 존재하는 CLI를 반환.
 */
export function detectGlobalCLIs(): AITool[] {
  const home = path.join(os.homedir())
  return AI_TOOLS.filter((tool) =>
    fs.existsSync(path.join(home, tool.skillsDir))
  )
}
