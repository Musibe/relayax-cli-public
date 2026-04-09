import fs from 'fs'
import path from 'path'
import os from 'os'
import type { InstalledRegistry } from '../types.js'
import { detectAgentCLIs } from './ai-tools.js'

import { getRegistryUrl } from './anpm-config.js'

export const API_URL = getRegistryUrl()

const GLOBAL_ANPM_DIR = path.join(process.env.ANPM_HOME ?? process.env.RELAY_HOME ?? os.homedir(), '.anpm')

/**
 * 설치 경로를 결정한다.
 * 1. --path 옵션이 있으면 그대로 사용
 * 2. 에이전트 CLI 자동 감지 → 감지된 경로 사용
 * 3. 감지 안 되면 현재 디렉토리에 직접 설치
 */
export function getInstallPath(override?: string): string {
  if (override) {
    const homeDir = process.env.RELAY_HOME ?? os.homedir()
    const resolved = override.startsWith('~')
      ? path.join(homeDir, override.slice(1))
      : path.resolve(override)
    return resolved
  }

  const projectRoot = getProjectRoot()
  const detected = detectAgentCLIs(projectRoot)

  if (detected.length >= 1) {
    return path.join(projectRoot, detected[0].skillsDir)
  }

  return projectRoot
}

/** ~/.anpm/ — 글로벌 (token, CLI cache) */
export function ensureGlobalAnpmDir(): void {
  if (!fs.existsSync(GLOBAL_ANPM_DIR)) {
    fs.mkdirSync(GLOBAL_ANPM_DIR, { recursive: true })
  }
}

/** 프로젝트 루트 경로 (RELAY_PROJECT_PATH > cwd) */
function getProjectRoot(): string {
  return process.env.RELAY_PROJECT_PATH ?? process.cwd()
}

/** cwd/.anpm/ — 프로젝트 로컬 (installed.json, agents/) */
export function ensureProjectAnpmDir(): void {
  const dir = path.join(getProjectRoot(), '.anpm')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 프로젝트 로컬 .anpm/ 디렉토리 */
export function getProjectAnpmDir(): string {
  return path.join(getProjectRoot(), '.anpm')
}

export interface TokenData {
  access_token: string
  refresh_token?: string
  expires_at?: number  // unix epoch seconds
}

export function loadTokenData(): TokenData | undefined {
  const tokenFile = path.join(GLOBAL_ANPM_DIR, 'token')
  if (!fs.existsSync(tokenFile)) return undefined
  try {
    const raw = fs.readFileSync(tokenFile, 'utf-8').trim()
    if (!raw) return undefined
    if (raw.startsWith('{')) {
      return JSON.parse(raw) as TokenData
    }
    // plain text (기존 포맷) — 호환성 유지
    return { access_token: raw }
  } catch {
    return undefined
  }
}

export function loadToken(): string | undefined {
  return loadTokenData()?.access_token
}

export function saveTokenData(data: TokenData): void {
  ensureGlobalAnpmDir()
  const tokenFile = path.join(GLOBAL_ANPM_DIR, 'token')
  fs.writeFileSync(tokenFile, JSON.stringify(data), { mode: 0o600 })
  // writeFileSync mode only applies on creation — fix existing files
  fs.chmodSync(tokenFile, 0o600)
}

export function saveToken(token: string): void {
  ensureGlobalAnpmDir()
  const tokenFile = path.join(GLOBAL_ANPM_DIR, 'token')
  fs.writeFileSync(tokenFile, JSON.stringify({ access_token: token }), { mode: 0o600 })
  fs.chmodSync(tokenFile, 0o600)
}

const LOCK_FILE = path.join(GLOBAL_ANPM_DIR, '.token.lock')
const LOCK_TIMEOUT = 15000 // 15s

/**
 * 파일 기반 lock — 여러 CLI 프로세스가 동시에 refresh하는 것을 방지.
 * Supabase refresh token rotation으로 인해 동시 refresh가 치명적.
 */
function acquireLock(): boolean {
  try {
    // O_EXCL: 파일이 이미 존재하면 실패 (atomic)
    const fd = fs.openSync(LOCK_FILE, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY)
    fs.writeSync(fd, String(Date.now()))
    fs.closeSync(fd)
    return true
  } catch {
    // lock 파일이 이미 있음 — stale check
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8')
      const lockTime = Number(content)
      if (Date.now() - lockTime > LOCK_TIMEOUT) {
        // stale lock — 제거 후 재시도
        fs.unlinkSync(LOCK_FILE)
        return acquireLock()
      }
    } catch { /* ignore */ }
    return false
  }
}

function releaseLock(): void {
  try { fs.unlinkSync(LOCK_FILE) } catch { /* ignore */ }
}

async function doRefresh(refreshToken: string): Promise<TokenData | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return (await res.json()) as TokenData
  } catch {
    return null
  }
}

/**
 * 유효한 access_token을 반환한다.
 *
 * Supabase는 refresh token rotation을 사용하므로:
 * - refresh 시 이전 refresh_token이 무효화됨
 * - 병렬 CLI 호출에서 동시 refresh 방지 필요 (lock)
 * - refresh 성공 시 새 토큰을 즉시 파일에 저장
 *
 * 타이밍:
 * - 만료 10분 전부터 proactive refresh
 * - refresh 실패해도 access_token이 아직 유효하면 계속 사용
 */
export async function getValidToken(): Promise<string | undefined> {
  // RELAY_TOKEN 환경변수가 있으면 최우선 사용 (sandbox/CI 환경)
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN

  // 매번 파일에서 새로 읽음 (다른 프로세스가 갱신했을 수 있으므로)
  const data = loadTokenData()
  if (!data) return undefined

  const now = Date.now() / 1000

  // expires_at이 없으면(레거시) → 유효하다고 간주
  if (!data.expires_at) return data.access_token

  // 10분 이상 남았으면 → 그대로 사용 (refresh 불필요)
  if (data.expires_at > now + 600) {
    return data.access_token
  }

  // refresh_token 없으면 만료 전까지만 사용
  if (!data.refresh_token) {
    return data.expires_at > now ? data.access_token : undefined
  }

  // Refresh 시도 — lock으로 프로세스 간 동시 refresh 방지
  if (acquireLock()) {
    try {
      const refreshed = await doRefresh(data.refresh_token!)
      if (refreshed) {
        saveTokenData(refreshed)
        return refreshed.access_token
      }
    } finally {
      releaseLock()
    }
  } else {
    // 다른 프로세스가 refresh 중 — 잠시 후 파일에서 다시 읽기
    await new Promise((r) => setTimeout(r, 2000))
    const retryData = loadTokenData()
    if (retryData?.expires_at && retryData.expires_at > now + 30) {
      return retryData.access_token
    }
  }

  // access_token이 아직 유효하면 사용
  return data.expires_at > now ? data.access_token : undefined
}

/**
 * 레거시 키 정규화:
 * - `@spaces/{slug}/{agent}` → `@{slug}/{agent}` (Space 레거시)
 * - `space_slug` → `org_slug` (필드명 마이그레이션)
 */
function normalizeInstalledRegistry(raw: InstalledRegistry): InstalledRegistry {
  const normalized: InstalledRegistry = {}
  for (const [key, value] of Object.entries(raw)) {
    // @spaces/ 레거시 키 정규화
    const m = key.match(/^@spaces\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/)
    const normalizedKey = m ? `@${m[1]}/${m[2]}` : key
    // space_slug → org_slug 필드 마이그레이션
    const entry = { ...value }
    if ('space_slug' in entry) {
      const spaceSlugs = entry as Record<string, unknown>
      entry.org_slug = spaceSlugs.space_slug as string | undefined
      delete spaceSlugs.space_slug
    }
    normalized[normalizedKey] = entry
  }
  return normalized
}

/** 프로젝트 로컬 installed.json 읽기 (.anpm/ 우선, .relay/ 폴백) */
export function loadInstalled(): InstalledRegistry {
  const file = path.join(getProjectAnpmDir(), 'installed.json')
  if (!fs.existsSync(file)) {
    return {}
  }
  try {
    return normalizeInstalledRegistry(JSON.parse(fs.readFileSync(file, 'utf-8')) as InstalledRegistry)
  } catch {
    return {}
  }
}

/** 프로젝트 로컬 installed.json 쓰기 */
export function saveInstalled(registry: InstalledRegistry): void {
  ensureProjectAnpmDir()
  const file = path.join(getProjectAnpmDir(), 'installed.json')
  fs.writeFileSync(file, JSON.stringify(registry, null, 2))
}

// ─── 글로벌 레지스트리 ───

/** 글로벌 installed.json 읽기 (~/.relay/installed.json) */
export function loadGlobalInstalled(): InstalledRegistry {
  const file = path.join(GLOBAL_ANPM_DIR, 'installed.json')
  if (!fs.existsSync(file)) return {}
  try {
    return normalizeInstalledRegistry(JSON.parse(fs.readFileSync(file, 'utf-8')) as InstalledRegistry)
  } catch {
    return {}
  }
}

/** 글로벌 installed.json 쓰기 (~/.relay/installed.json) */
export function saveGlobalInstalled(registry: InstalledRegistry): void {
  ensureGlobalAnpmDir()
  const file = path.join(GLOBAL_ANPM_DIR, 'installed.json')
  fs.writeFileSync(file, JSON.stringify(registry, null, 2))
}

/** 글로벌 + 로컬 레지스트리 병합 뷰 */
export function loadMergedInstalled(): { global: InstalledRegistry; local: InstalledRegistry } {
  return { global: loadGlobalInstalled(), local: loadInstalled() }
}
