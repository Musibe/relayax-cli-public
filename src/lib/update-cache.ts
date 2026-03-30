import fs from 'fs'
import path from 'path'
import os from 'os'

const RELAY_DIR = path.join(os.homedir(), '.relay')
const CACHE_FILE = path.join(RELAY_DIR, 'last-update-check')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CacheData {
  cli?: string
  agents?: Record<string, string>
}

function loadCache(): CacheData {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {}
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheData
  } catch {
    return {}
  }
}

function saveCache(data: CacheData): void {
  if (!fs.existsSync(RELAY_DIR)) {
    fs.mkdirSync(RELAY_DIR, { recursive: true })
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
}

export function isCacheValid(key: 'cli' | string, force?: boolean): boolean {
  if (force) return false
  const cache = loadCache()
  const timestamp = key === 'cli' ? cache.cli : cache.agents?.[key]
  if (!timestamp) return false
  return Date.now() - new Date(timestamp).getTime() < CACHE_TTL_MS
}

export function updateCacheTimestamp(key: 'cli' | string): void {
  const cache = loadCache()
  const now = new Date().toISOString()
  if (key === 'cli') {
    cache.cli = now
  } else {
    if (!cache.agents) cache.agents = {}
    cache.agents[key] = now
  }
  saveCache(cache)
}
