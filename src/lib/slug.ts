import { resolveSlugFromServer } from './api.js'

export interface ParsedSlug {
  owner: string   // "haemin"
  name: string    // "content-agent"
  full: string    // "@haemin/content-agent"
}

const SCOPED_SLUG_RE = /^@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/
const SIMPLE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

// ── Korean romanization (Revised Romanization) ──

const INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp',
  's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const

const MEDIALS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o',
  'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu',
  'eu', 'ui', 'i',
] as const

const FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l',
  'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p',
  'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
] as const

const HANGUL_BASE = 0xAC00

function romanize(input: string): string {
  let result = ''
  for (const ch of input) {
    const code = ch.codePointAt(0)!
    if (code >= HANGUL_BASE && code < HANGUL_BASE + 11172) {
      const offset = code - HANGUL_BASE
      const initial = Math.floor(offset / (21 * 28))
      const medial = Math.floor((offset % (21 * 28)) / 28)
      const final = offset % 28
      result += INITIALS[initial] + MEDIALS[medial] + FINALS[final]
    } else {
      result += ch
    }
  }
  return result
}

/**
 * Convert an arbitrary string to a slug.
 * Korean characters are romanized (e.g., "content agent" stays as-is).
 */
export function slugify(input: string): string {
  return romanize(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

/**
 * Synchronously parse a scoped slug (`@owner/name`).
 * Returns null for simple (unscoped) slugs.
 */
export function parseSlug(input: string): ParsedSlug | null {
  const m = input.match(SCOPED_SLUG_RE)
  if (!m) return null
  return { owner: m[1], name: m[2], full: input }
}

/** Check if input is a scoped slug */
export function isScopedSlug(input: string): boolean {
  return SCOPED_SLUG_RE.test(input)
}

/** Check if input is a simple slug */
export function isSimpleSlug(input: string): boolean {
  return SIMPLE_SLUG_RE.test(input)
}

/**
 * Accept a scoped or simple slug and return a ParsedSlug.
 * Simple slugs are resolved via the server.
 */
export async function resolveSlug(input: string): Promise<ParsedSlug> {
  // Scoped slug — parse directly
  const parsed = parseSlug(input)
  if (parsed) return parsed

  // Validate simple slug format
  if (!isSimpleSlug(input)) {
    throw new Error(`Invalid slug format: '${input}'. Use @owner/name or name format.`)
  }

  // Resolve via server
  const results = await resolveSlugFromServer(input)

  if (results.length === 0) {
    throw new Error(`Agent '${input}' not found.`)
  }

  if (results.length === 1) {
    const r = results[0]
    return { owner: r.owner, name: r.name, full: r.full }
  }

  // Multiple matches
  const list = results.map((r) => `  ${r.full}`).join('\n')
  throw new Error(
    `Multiple agents match '${input}'. Please specify the full slug:\n${list}`
  )
}
