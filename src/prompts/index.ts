import fs from 'fs'
import path from 'path'

function readPrompt(filename: string): string {
  return fs.readFileSync(path.join(__dirname, filename), 'utf-8').trim()
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// ─── 공유 조각 ───
export const REQUIREMENTS_CHECK = readPrompt('_requirements-check.md')
export const ERROR_HANDLING_GUIDE = readPrompt('_error-handling.md')
export const SETUP_ENVIRONMENT = readPrompt('_setup-environment.md')
export const SETUP_CLI = readPrompt('_setup-cli.md')
export const SETUP_LOGIN = readPrompt('_setup-login.md')
export const GUIDE_INSTRUCTION = readPrompt('_guide-instruction.md')

const fragments: Record<string, string> = {
  REQUIREMENTS_CHECK,
  ERROR_HANDLING_GUIDE,
  GUIDE_INSTRUCTION,
}

// ─── 전체 프롬프트 (조각 합성 완료) ───
export const INSTALL_PROMPT = interpolate(readPrompt('install.md'), fragments)
export const PUBLISH_PROMPT = interpolate(readPrompt('publish.md'), fragments)
