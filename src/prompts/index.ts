import fs from 'fs'
import path from 'path'

function readPrompt(filename: string): string {
  return fs.readFileSync(path.join(__dirname, filename), 'utf-8').trim()
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// ─── 공유 조각 ───
export const ERROR_HANDLING_GUIDE = readPrompt('_error-handling.md')

const fragments: Record<string, string> = {
  ERROR_HANDLING_GUIDE,
}

// ─── 프롬프트 ───
export const EXPLORE_PROMPT = interpolate(readPrompt('explore.md'), fragments)
export const CREATE_PROMPT = interpolate(readPrompt('create.md'), fragments)
