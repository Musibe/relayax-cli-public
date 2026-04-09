import fs from 'fs'
import path from 'path'
import os from 'os'
import type { InstalledRegistry } from '../types.js'
import { detectAgentCLIs } from './ai-tools.js'

import { getRegistryUrl } from './anpm-config.js'

export const API_URL = getRegistryUrl()

const GLOBAL_ANPM_DIR = path.join(process.env.ANPM_HOME ?? process.env.RELAY_HOME ?? os.homedir(), '.anpm')

/**
 * Determine install path.
 * 1. Use --path option if provided
 * 2. Auto-detect agent CLI → use detected path
 * 3. If not detected, install to current directory
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

/** ~/.anpm/ — global (token, CLI cache) */
export function ensureGlobalAnpmDir(): void {
  if (!fs.existsSync(GLOBAL_ANPM_DIR)) {
    fs.mkdirSync(GLOBAL_ANPM_DIR, { recursive: true })
  }
}

/** Project root path (RELAY_PROJECT_PATH > cwd) */
function getProjectRoot(): string {
  return process.env.RELAY_PROJECT_PATH ?? process.cwd()
}

/** cwd/.anpm/ — project local (installed.json, agents/) */
export function ensureProjectAnpmDir(): void {
  const dir = path.join(getProjectRoot(), '.anpm')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Project local .anpm/ directory */
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
    // plain text (legacy format) — backward compatibility
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
 * File-based lock — prevents concurrent refresh across CLI processes.
 * Concurrent refresh is fatal due to Supabase refresh token rotation.
 */
function acquireLock(): boolean {
  try {
    // O_EXCL: fail if file already exists (atomic)
    const fd = fs.openSync(LOCK_FILE, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY)
    fs.writeSync(fd, String(Date.now()))
    fs.closeSync(fd)
    return true
  } catch {
    // Lock file already exists — stale check
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8')
      const lockTime = Number(content)
      if (Date.now() - lockTime > LOCK_TIMEOUT) {
        // stale lock — remove and retry
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
 * Return a valid access_token.
 *
 * Supabase uses refresh token rotation:
 * - Previous refresh_token is invalidated on refresh
 * - Concurrent refresh must be prevented across parallel CLI calls (lock)
 * - Save new tokens to file immediately on refresh success
 *
 * Timing:
 * - Proactive refresh starting 10 minutes before expiry
 * - Continue using access_token even if refresh fails, as long as it is still valid
 */
export async function getValidToken(): Promise<string | undefined> {
  // RELAY_TOKEN env var takes highest priority (sandbox/CI)
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN

  // Read from file each time (another process may have refreshed)
  const data = loadTokenData()
  if (!data) return undefined

  const now = Date.now() / 1000

  // No expires_at (legacy) → assume valid
  if (!data.expires_at) return data.access_token

  // 10+ minutes remaining → use as-is (no refresh needed)
  if (data.expires_at > now + 600) {
    return data.access_token
  }

  // No refresh_token → use until expiry
  if (!data.refresh_token) {
    return data.expires_at > now ? data.access_token : undefined
  }

  // Attempt refresh — lock prevents concurrent refresh across processes
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
    // Another process is refreshing — retry reading from file after a short wait
    await new Promise((r) => setTimeout(r, 2000))
    const retryData = loadTokenData()
    if (retryData?.expires_at && retryData.expires_at > now + 30) {
      return retryData.access_token
    }
  }

  // Use access_token if still valid
  return data.expires_at > now ? data.access_token : undefined
}

/**
 * Normalize legacy keys:
 * - `@spaces/{slug}/{agent}` → `@{slug}/{agent}` (Space legacy)
 * - `space_slug` → `org_slug` (field name migration)
 */
function normalizeInstalledRegistry(raw: InstalledRegistry): InstalledRegistry {
  const normalized: InstalledRegistry = {}
  for (const [key, value] of Object.entries(raw)) {
    // Normalize @spaces/ legacy keys
    const m = key.match(/^@spaces\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/)
    const normalizedKey = m ? `@${m[1]}/${m[2]}` : key
    // Migrate space_slug → org_slug field
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

/** Read project local installed.json (.anpm/ preferred, .relay/ fallback) */
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

/** Write project local installed.json */
export function saveInstalled(registry: InstalledRegistry): void {
  ensureProjectAnpmDir()
  const file = path.join(getProjectAnpmDir(), 'installed.json')
  fs.writeFileSync(file, JSON.stringify(registry, null, 2))
}

// ─── Global registry ───

/** Read global installed.json (~/.relay/installed.json) */
export function loadGlobalInstalled(): InstalledRegistry {
  const file = path.join(GLOBAL_ANPM_DIR, 'installed.json')
  if (!fs.existsSync(file)) return {}
  try {
    return normalizeInstalledRegistry(JSON.parse(fs.readFileSync(file, 'utf-8')) as InstalledRegistry)
  } catch {
    return {}
  }
}

/** Write global installed.json (~/.relay/installed.json) */
export function saveGlobalInstalled(registry: InstalledRegistry): void {
  ensureGlobalAnpmDir()
  const file = path.join(GLOBAL_ANPM_DIR, 'installed.json')
  fs.writeFileSync(file, JSON.stringify(registry, null, 2))
}

/** Merged view of global + local registries */
export function loadMergedInstalled(): { global: InstalledRegistry; local: InstalledRegistry } {
  return { global: loadGlobalInstalled(), local: loadInstalled() }
}
