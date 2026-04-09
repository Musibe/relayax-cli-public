import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadMergedInstalled } from './config.js'
import { AI_TOOLS } from './ai-tools.js'
import type { InstalledAgent } from '../types.js'

export interface AgentStatusEntry {
  slug: string
  source: string
  version: string
  scope: 'global' | 'local'
  status: 'active' | 'broken' | 'unknown'
  harnesses: string[]
  symlinkCount: number
  brokenSymlinks: string[]
}

/**
 * Get detailed status of all installed agents with harness mapping.
 */
export function getAgentStatusEntries(): AgentStatusEntry[] {
  const { global: globalInstalled, local: localInstalled } = loadMergedInstalled()
  const entries: AgentStatusEntry[] = []

  function processRegistry(registry: Record<string, InstalledAgent>, scope: 'global' | 'local') {
    for (const [slug, info] of Object.entries(registry)) {
      const symlinks = info.deployed_symlinks ?? []
      const broken: string[] = []
      const harnessSet = new Set<string>()

      for (const link of symlinks) {
        if (!isSymlink(link)) {
          broken.push(link)
        } else {
          // Extract harness name from path
          const harnessName = extractHarnessName(link)
          if (harnessName) harnessSet.add(harnessName)
        }
      }

      entries.push({
        slug,
        source: info.source ?? 'registry',
        version: info.version,
        scope: (info.deploy_scope ?? scope) as 'global' | 'local',
        status: broken.length > 0 ? 'broken' : symlinks.length > 0 ? 'active' : 'unknown',
        harnesses: Array.from(harnessSet),
        symlinkCount: symlinks.length - broken.length,
        brokenSymlinks: broken,
      })
    }
  }

  processRegistry(globalInstalled, 'global')
  processRegistry(localInstalled, 'local')

  return entries
}

/**
 * Scan harness directories for unmanaged (non-relay) content.
 */
export function findUnmanagedContent(projectPath: string): { harness: string; type: string; name: string; path: string }[] {
  const unmanaged: { harness: string; type: string; name: string; path: string }[] = []
  const homeDir = os.homedir()
  const contentDirs = ['skills', 'commands', 'rules', 'agents'] as const

  for (const tool of AI_TOOLS) {
    // Check both global and local harness dirs
    const dirs = [
      { base: path.join(homeDir, tool.skillsDir), scope: 'global' },
      { base: path.join(projectPath, tool.skillsDir), scope: 'local' },
    ]

    for (const { base } of dirs) {
      for (const contentType of contentDirs) {
        const dir = path.join(base, contentType)
        if (!fs.existsSync(dir)) continue

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          if (entry.name === 'relay') continue // skip relay's own dir
          const entryPath = path.join(dir, entry.name)

          // If it's not a symlink pointing into .relay/agents/, it's unmanaged
          if (!isRelaySymlink(entryPath)) {
            unmanaged.push({
              harness: tool.name,
              type: contentType,
              name: entry.name,
              path: entryPath,
            })
          }
        }
      }
    }
  }

  // Deduplicate by path
  const seen = new Set<string>()
  return unmanaged.filter((item) => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

function isSymlink(p: string): boolean {
  try {
    const stat = fs.lstatSync(p)
    if (!stat.isSymbolicLink()) return false
    // Also check if target exists
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function isRelaySymlink(p: string): boolean {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return false
    const target = fs.readlinkSync(p)
    return target.includes('.relay/agents/') || target.includes('.relay\\agents\\')
  } catch {
    return false
  }
}

function extractHarnessName(symlinkPath: string): string | undefined {
  for (const tool of AI_TOOLS) {
    if (symlinkPath.includes(tool.skillsDir)) {
      return tool.name
    }
  }
  return undefined
}
