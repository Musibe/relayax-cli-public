import fs from 'fs'
import path from 'path'

export interface LockEntry {
  version: string
  resolved: string
  integrity?: string
}

export interface RelayLock {
  lockfile_version: number
  agents: Record<string, LockEntry>
}

const LOCK_FILENAME = 'relay.lock'

export function loadLockfile(projectPath: string): RelayLock | null {
  const lockPath = path.join(projectPath, LOCK_FILENAME)
  if (!fs.existsSync(lockPath)) return null
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as RelayLock
  } catch {
    return null
  }
}

export function saveLockfile(projectPath: string, lock: RelayLock): void {
  const lockPath = path.join(projectPath, LOCK_FILENAME)
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
}

export function updateLockEntry(projectPath: string, slug: string, entry: LockEntry): void {
  let lock = loadLockfile(projectPath)
  if (!lock) {
    lock = { lockfile_version: 1, agents: {} }
  }
  lock.agents[slug] = entry
  saveLockfile(projectPath, lock)
}

export function removeLockEntry(projectPath: string, slug: string): void {
  const lock = loadLockfile(projectPath)
  if (!lock) return
  delete lock.agents[slug]
  saveLockfile(projectPath, lock)
}
