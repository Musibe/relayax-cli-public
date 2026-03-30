import { resolveSlugFromServer } from './api.js'

export interface ParsedSlug {
  owner: string   // "haemin"
  name: string    // "content-agent"
  full: string    // "@haemin/content-agent"
}

const SCOPED_SLUG_RE = /^@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/
const SIMPLE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Scoped slug(`@owner/name`)를 동기적으로 파싱한다.
 * 단순 slug는 파싱할 수 없으므로 null을 반환한다.
 */
export function parseSlug(input: string): ParsedSlug | null {
  const m = input.match(SCOPED_SLUG_RE)
  if (!m) return null
  return { owner: m[1], name: m[2], full: input }
}

/** input이 scoped slug인지 확인 */
export function isScopedSlug(input: string): boolean {
  return SCOPED_SLUG_RE.test(input)
}

/** input이 단순 slug인지 확인 */
export function isSimpleSlug(input: string): boolean {
  return SIMPLE_SLUG_RE.test(input)
}

/**
 * Scoped 또는 단순 slug를 받아 ParsedSlug를 반환한다.
 * 단순 slug는 서버에 resolve를 요청한다.
 */
export async function resolveSlug(input: string): Promise<ParsedSlug> {
  // scoped slug면 바로 파싱
  const parsed = parseSlug(input)
  if (parsed) return parsed

  // 단순 slug인지 검증
  if (!isSimpleSlug(input)) {
    throw new Error(`잘못된 slug 형식입니다: '${input}'. @owner/name 또는 name 형태로 입력하세요.`)
  }

  // 서버에 resolve 요청
  const results = await resolveSlugFromServer(input)

  if (results.length === 0) {
    throw new Error(`'${input}' 에이전트를 찾을 수 없습니다.`)
  }

  if (results.length === 1) {
    const r = results[0]
    return { owner: r.owner, name: r.name, full: r.full }
  }

  // 여러 개 매칭
  const list = results.map((r) => `  ${r.full}`).join('\n')
  throw new Error(
    `'${input}'에 해당하는 에이전트가 여러 개입니다. 전체 slug를 지정해주세요:\n${list}`
  )
}
