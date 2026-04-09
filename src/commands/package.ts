import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Command } from 'commander'
import yaml from 'js-yaml'
import {
  detectAgentCLIs,
  detectGlobalCLIs,
  scanLocalItems,
  scanGlobalItems,
  type ContentItem,
} from '../lib/ai-tools.js'
import { resolveProjectPath, resolveHome } from '../lib/paths.js'

const SYNC_DIRS = ['skills', 'commands', 'agents', 'rules'] as const

// ─── Types ───

interface FileEntry {
  /** Relative path from .relay/ (e.g., skills/my-skill/SKILL.md) */
  relPath: string
  hash: string
}

type DiffStatus = 'added' | 'modified' | 'deleted' | 'unchanged'

interface DiffEntry {
  relPath: string
  status: DiffStatus
}

// ─── Contents Manifest Types ───

import type { ContentType } from '../lib/ai-tools.js'

export interface ContentEntry {
  name: string
  type: ContentType
  from?: string // relative path (.claude/skills/x) or global (~/.claude/skills/x)
  path?: string // alias for from (path also works in relay.yaml)
}

/** Return whichever of from or path is set */
function getFromPath(entry: ContentEntry): string {
  const val = entry.from ?? entry.path
  if (!val) {
    throw new Error(`Contents entry "${entry.name}" requires a from or path field.`)
  }
  return val
}

type ContentDiffStatus = 'modified' | 'unchanged' | 'source_missing'

interface ContentDiffEntry {
  name: string
  type: ContentType
  status: ContentDiffStatus
  files?: DiffEntry[]
}

interface NewItemEntry {
  name: string
  type: ContentType
  source: string
  relativePath: string
}


// ─── Helpers ───

function fileHash(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * Compare source with .relay/ and generate a diff.
 */
function computeDiff(sourceFiles: FileEntry[], relayFiles: FileEntry[]): DiffEntry[] {
  const relayMap = new Map(relayFiles.map((f) => [f.relPath, f.hash]))
  const sourceMap = new Map(sourceFiles.map((f) => [f.relPath, f.hash]))
  const diff: DiffEntry[] = []

  // Files in source
  for (const [relPath, hash] of sourceMap) {
    const relayHash = relayMap.get(relPath)
    if (!relayHash) {
      diff.push({ relPath, status: 'added' })
    } else if (relayHash !== hash) {
      diff.push({ relPath, status: 'modified' })
    } else {
      diff.push({ relPath, status: 'unchanged' })
    }
  }

  // Files only in .relay/ (deleted from source)
  for (const [relPath] of relayMap) {
    if (!sourceMap.has(relPath)) {
      diff.push({ relPath, status: 'deleted' })
    }
  }

  return diff.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * Sync files from source to .relay/.
 */
function syncToRelay(sourceBase: string, relayDir: string, diff: DiffEntry[]): void {
  for (const entry of diff) {
    const sourcePath = path.join(sourceBase, entry.relPath)
    const relayPath = path.join(relayDir, entry.relPath)

    if (entry.status === 'added' || entry.status === 'modified') {
      fs.mkdirSync(path.dirname(relayPath), { recursive: true })
      fs.copyFileSync(sourcePath, relayPath)
    } else if (entry.status === 'deleted') {
      if (fs.existsSync(relayPath)) {
        fs.unlinkSync(relayPath)
        // Clean up empty directories
        const parentDir = path.dirname(relayPath)
        try {
          const remaining = fs.readdirSync(parentDir).filter((f) => !f.startsWith('.'))
          if (remaining.length === 0) fs.rmdirSync(parentDir)
        } catch { /* ignore */ }
      }
    }
  }
}

// ─── Contents-based Helpers ───

/**
 * Resolve a from path to an absolute path.
 * Paths starting with ~/ resolve to home directory, others relative to projectPath.
 */
function resolveFromPath(fromPath: string, projectPath: string): string {
  if (fromPath.startsWith('~/')) {
    return path.join(os.homedir(), fromPath.slice(2))
  }
  return path.join(projectPath, fromPath)
}

/**
 * Recursively scan a file or directory and return FileEntry[].
 * relPath is relative to baseDir.
 */
function scanPath(absPath: string): FileEntry[] {
  if (!fs.existsSync(absPath)) return []

  const stat = fs.statSync(absPath)
  if (stat.isFile()) {
    return [{ relPath: path.basename(absPath), hash: fileHash(absPath) }]
  }

  // Directory
  const entries: FileEntry[] = []
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else {
        entries.push({ relPath: path.relative(absPath, fullPath), hash: fileHash(fullPath) })
      }
    }
  }
  walk(absPath)
  return entries
}

/**
 * Compare original and .relay/ copy of each item based on the contents manifest.
 */
export function computeContentsDiff(
  contents: ContentEntry[],
  relayDir: string,
  projectPath: string,
): { diff: ContentDiffEntry[]; newItems: NewItemEntry[] } {
  const diff: ContentDiffEntry[] = []

  for (const entry of contents) {
    const absFrom = resolveFromPath(getFromPath(entry), projectPath)

    if (!fs.existsSync(absFrom)) {
      diff.push({ name: entry.name, type: entry.type, status: 'source_missing' })
      continue
    }

    // Determine corresponding location in .relay/ from the from path
    // from: .claude/skills/code-review → .relay/skills/code-review
    // from: ~/.claude/skills/code-review → .relay/skills/code-review
    const relaySubPath = deriveRelaySubPath(entry)
    const relayItemDir = path.join(relayDir, relaySubPath)

    const sourceFiles = scanPath(absFrom)
    const relayFiles = scanPath(relayItemDir)

    const fileDiff = computeDiff(sourceFiles, relayFiles)
    const hasChanges = fileDiff.some((d) => d.status !== 'unchanged')

    diff.push({
      name: entry.name,
      type: entry.type,
      status: hasChanges ? 'modified' : 'unchanged',
      files: hasChanges ? fileDiff.filter((d) => d.status !== 'unchanged') : undefined,
    })
  }

  // Re-scan source directories to detect new items not in contents
  const newItems = discoverNewItems(contents, projectPath)

  return { diff, newItems }
}

/**
 * Derive .relay/ sub-path from a contents entry's from path.
 * e.g., .claude/skills/code-review → skills/code-review
 *     ~/.claude/agents/dev-lead.md → agents/dev-lead.md
 */
function deriveRelaySubPath(entry: ContentEntry): string {
  const fromPath = getFromPath(entry)
  const from = fromPath.startsWith('~/') ? fromPath.slice(2) : fromPath
  // Extract skills/xxx, agents/xxx etc. patterns
  for (const dir of SYNC_DIRS) {
    const idx = from.indexOf(`/${dir}/`)
    if (idx !== -1) {
      return from.slice(idx + 1) // /skills/code-review → skills/code-review
    }
  }
  // fallback: type + name
  return `${entry.type}s/${entry.name}`
}

/**
 * Find new items in source directories that are not registered in contents.
 */
function discoverNewItems(contents: ContentEntry[], projectPath: string): NewItemEntry[] {
  const existingNames = new Set(contents.map((c) => `${c.type}:${c.name}`))
  const newItems: NewItemEntry[] = []

  // Scan local sources
  const localTools = detectAgentCLIs(projectPath)
  for (const tool of localTools) {
    const items = scanLocalItems(projectPath, tool)
    for (const item of items) {
      if (!existingNames.has(`${item.type}:${item.name}`)) {
        newItems.push({
          name: item.name,
          type: item.type,
          source: tool.skillsDir,
          relativePath: item.relativePath,
        })
      }
    }
  }

  // Scan global sources
  const globalTools = detectGlobalCLIs()
  for (const tool of globalTools) {
    const items = scanGlobalItems(tool)
    for (const item of items) {
      if (!existingNames.has(`${item.type}:${item.name}`)) {
        newItems.push({
          name: item.name,
          type: item.type,
          source: `~/${tool.skillsDir}`,
          relativePath: item.relativePath,
        })
      }
    }
  }

  return newItems
}

/**
 * Sync from → .relay/ per contents entry.
 */
export function syncContentsToRelay(
  contents: ContentEntry[],
  contentsDiff: ContentDiffEntry[],
  relayDir: string,
  projectPath: string,
): { removed: string[] } {
  const removed: string[] = []

  for (const diffEntry of contentsDiff) {
    const content = contents.find((c) => c.name === diffEntry.name && c.type === diffEntry.type)

    // source_missing: deleted from source → remove from .relay/ too
    if (diffEntry.status === 'source_missing') {
      const relaySubPath = content ? deriveRelaySubPath(content) : `${diffEntry.type}s/${diffEntry.name}`
      const relayTarget = path.join(relayDir, relaySubPath)
      if (fs.existsSync(relayTarget)) {
        fs.rmSync(relayTarget, { recursive: true, force: true })
        removed.push(relaySubPath)
      }
      continue
    }

    if (diffEntry.status !== 'modified') continue
    if (!content) continue

    const absFrom = resolveFromPath(getFromPath(content), projectPath)
    const relaySubPath = deriveRelaySubPath(content)
    const relayTarget = path.join(relayDir, relaySubPath)

    // Single file — copy directly
    if (fs.existsSync(absFrom) && fs.statSync(absFrom).isFile()) {
      fs.mkdirSync(path.dirname(relayTarget), { recursive: true })
      fs.copyFileSync(absFrom, relayTarget)
      continue
    }

    // Directory — diff-based sync (including deleted)
    const sourceFiles = scanPath(absFrom)
    const relayFiles = scanPath(relayTarget)
    const fileDiff = computeDiff(sourceFiles, relayFiles)
    syncToRelay(absFrom, relayTarget, fileDiff)
  }

  return { removed }
}

/**
 * Find orphan items in .relay/ that are not in the contents manifest.
 */
export function findOrphanItems(contents: ContentEntry[], relayDir: string): string[] {
  const contentPaths = new Set(contents.map((c) => deriveRelaySubPath(c)))
  const orphans: string[] = []

  for (const dir of SYNC_DIRS) {
    const fullDir = path.join(relayDir, dir)
    if (!fs.existsSync(fullDir)) continue

    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const relPath = `${dir}/${entry.name}`
      if (!contentPaths.has(relPath)) {
        orphans.push(relPath)
      }
    }
  }

  return orphans
}

// ─── Global Agent Home ───

/**
 * Determine the package home directory.
 * 1. If project has .relay/ → projectPath/.relay/
 * 2. Otherwise → ~/.relay/agents/<slug>/ (slug required)
 *
 * Returns null if no slug and no project .relay/.
 */
export function resolveRelayDir(projectPath: string, slug?: string): string | null {
  const projectRelay = path.join(projectPath, '.relay')
  if (fs.existsSync(path.join(projectRelay, 'relay.yaml'))) {
    return projectRelay
  }
  // .relay/ exists without relay.yaml — still project mode
  if (fs.existsSync(projectRelay)) {
    return projectRelay
  }
  // Global agent home
  if (slug) {
    return path.join(os.homedir(), '.relay', 'agents', slug)
  }
  return null
}

/**
 * Initialize package structure in the global agent home.
 */
export function initGlobalAgentHome(slug: string, yamlData: Record<string, unknown>): string {
  const agentDir = path.join(os.homedir(), '.relay', 'agents', slug)
  fs.mkdirSync(agentDir, { recursive: true })
  fs.mkdirSync(path.join(agentDir, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(agentDir, 'agents'), { recursive: true })
  fs.writeFileSync(
    path.join(agentDir, 'relay.yaml'),
    yaml.dump(yamlData, { lineWidth: 120 }),
    'utf-8',
  )
  return agentDir
}

// ─── Command ───

export function registerPackage(program: Command): void {
  program
    .command('package', { hidden: true })
    .description('Sync content from source directories to .relay/')
    .option('--source <dir>', 'Source directory (e.g., .claude)')
    .option('--sync', 'Apply changes to .relay/ immediately', false)
    .option('--init', 'Initial packaging: detect sources → initialize .relay/', false)
    .option('--migrate', 'Migrate legacy source field to contents', false)
    .option('--project <dir>', 'Project root path (default: cwd, env: RELAY_PROJECT_PATH)')
    .option('--home <dir>', 'Home directory path (default: os.homedir(), env: RELAY_HOME)')
    .action(async (opts: { source?: string; sync?: boolean; init?: boolean; migrate?: boolean; project?: string; home?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const homeDir = resolveHome(opts.home)
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')

      // ─── Initial packaging (--init) ───
      if (opts.init || !fs.existsSync(relayYamlPath)) {
        // Scan both local + global sources to generate item lists
        const localTools = detectAgentCLIs(projectPath)
        const globalTools = detectGlobalCLIs(homeDir)

        interface SourceEntry {
          path: string
          location: 'local' | 'global'
          name: string
          items: ContentItem[]
        }

        const sources: SourceEntry[] = []

        for (const tool of localTools) {
          const items = scanLocalItems(projectPath, tool)
          if (items.length > 0) {
            sources.push({
              path: tool.skillsDir,
              location: 'local',
              name: tool.name,
              items,
            })
          }
        }

        for (const tool of globalTools) {
          const items = scanGlobalItems(tool, homeDir)
          if (items.length > 0) {
            sources.push({
              path: `~/${tool.skillsDir}`,
              location: 'global',
              name: `${tool.name} (global)`,
              items,
            })
          }
        }

        // Scan ~/.relay/agents/ for existing agent packages
        const globalAgentsDir = path.join(homeDir ?? os.homedir(), '.relay', 'agents')
        const existingAgents: { slug: string; name: string; version: string; path: string }[] = []
        if (fs.existsSync(globalAgentsDir)) {
          for (const entry of fs.readdirSync(globalAgentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue
            const agentYaml = path.join(globalAgentsDir, entry.name, 'relay.yaml')
            if (fs.existsSync(agentYaml)) {
              try {
                const cfg = yaml.load(fs.readFileSync(agentYaml, 'utf-8')) as Record<string, unknown>
                existingAgents.push({
                  slug: (cfg.slug as string) ?? entry.name,
                  name: (cfg.name as string) ?? entry.name,
                  version: (cfg.version as string) ?? '0.0.0',
                  path: `~/.relay/agents/${entry.name}`,
                })
              } catch { /* skip invalid yaml */ }
            }
          }
        }

        if (json) {
          console.log(JSON.stringify({
            status: 'init_required',
            sources,
            existing_agents: existingAgents,
          }))
        } else {
          if (sources.length === 0 && existingAgents.length === 0) {
            console.error('No publishable agent content found.')
            console.error('Create at least one of: skills/, commands/, agents/, rules/')
            process.exit(1)
          }

          if (sources.length > 0) {
            console.error('\nDiscovered agent content:\n')
            for (const src of sources) {
              const typeCounts = new Map<string, number>()
              for (const item of src.items) {
                typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1)
              }
              const parts = Array.from(typeCounts.entries())
                .map(([t, c]) => `${t} ${c}`)
                .join(', ')
              const label = src.location === 'global' ? '🌐' : '📁'
              console.error(`  ${label} ${src.path}/ — ${parts}`)
            }
          }

          if (existingAgents.length > 0) {
            console.error('\nExisting global agents:\n')
            for (const agent of existingAgents) {
              console.error(`  📦 ${agent.name} (v${agent.version}) — ${agent.path}`)
            }
          }

          console.error('')
        }
        return
      }

      // ─── Migration (--migrate) ───
      if (opts.migrate) {
        const yamlMigrate = fs.readFileSync(relayYamlPath, 'utf-8')
        const cfgMigrate = yaml.load(yamlMigrate) as Record<string, unknown>

        if (cfgMigrate.contents) {
          if (json) {
            console.log(JSON.stringify({ status: 'already_migrated', message: 'Already using contents format.' }))
          } else {
            console.error('✓ Already using contents format.')
          }
          return
        }

        const legacySource = cfgMigrate.source as string | undefined
        if (!legacySource) {
          if (json) {
            console.log(JSON.stringify({ status: 'no_source', message: 'No source field found.' }))
          } else {
            console.error('No source field found. Initialize with anpm package --init.')
          }
          process.exit(1)
        }

        // Scan source directory and convert all items to contents[]
        const sourceBase = path.join(projectPath, legacySource)
        const migratedContents: ContentEntry[] = []

        if (fs.existsSync(sourceBase)) {
          const localTools = detectAgentCLIs(projectPath)
          const tool = localTools.find((t) => t.skillsDir === legacySource)
          if (tool) {
            const items = scanLocalItems(projectPath, tool)
            for (const item of items) {
              migratedContents.push({
                name: item.name,
                type: item.type,
                from: `${legacySource}/${item.relativePath}`,
              })
            }
          }
        }

        // Remove source from relay.yaml, save contents
        delete cfgMigrate.source
        cfgMigrate.contents = migratedContents
        fs.writeFileSync(relayYamlPath, yaml.dump(cfgMigrate, { lineWidth: 120 }), 'utf-8')

        if (json) {
          console.log(JSON.stringify({ status: 'migrated', contents: migratedContents }))
        } else {
          console.error(`✓ Migrated source(${legacySource}) → contents(${migratedContents.length} entries)`)
        }
        return
      }

      // ─── Re-packaging (contents manifest-based sync) ───
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = yaml.load(yamlContent) as Record<string, unknown>
      const rawContents = config.contents
      const contents: ContentEntry[] = Array.isArray(rawContents) ? rawContents : []

      // Legacy source field → contents migration notice
      if (!config.contents && config.source) {
        const legacySource = config.source as string
        if (json) {
          console.log(JSON.stringify({
            status: 'migration_required',
            message: `The source field in relay.yaml needs to be migrated to contents.`,
            legacy_source: legacySource,
          }))
        } else {
          console.error(`relay.yaml has a legacy source field (${legacySource}).`)
          console.error(`To migrate to contents format: anpm package --migrate`)
        }
        process.exit(1)
      }

      if (contents.length === 0) {
        if (json) {
          console.log(JSON.stringify({
            status: 'no_contents',
            message: 'No contents in relay.yaml. Initialize with anpm package --init.',
          }))
        } else {
          console.error('No contents in relay.yaml.')
          console.error('Initialize with anpm package --init.')
        }
        process.exit(1)
      }

      // Compute diff based on contents
      const { diff: contentsDiff, newItems } = computeContentsDiff(contents, relayDir, projectPath)
      const orphans = findOrphanItems(contents, relayDir)

      const summary = {
        modified: contentsDiff.filter((d) => d.status === 'modified').length,
        unchanged: contentsDiff.filter((d) => d.status === 'unchanged').length,
        source_missing: contentsDiff.filter((d) => d.status === 'source_missing').length,
        new_available: newItems.length,
        orphaned: orphans.length,
      }

      const hasChanges = summary.modified > 0 || summary.source_missing > 0 || summary.orphaned > 0

      // --sync: per-contents sync + orphan cleanup
      if (opts.sync && hasChanges) {
        const { removed } = syncContentsToRelay(contents, contentsDiff, relayDir, projectPath)
        // Delete orphan items
        for (const orphan of orphans) {
          const orphanPath = path.join(relayDir, orphan)
          if (fs.existsSync(orphanPath)) {
            fs.rmSync(orphanPath, { recursive: true, force: true })
            removed.push(orphan)
          }
        }
      }

      const result = {
        diff: contentsDiff.filter((d) => d.status !== 'unchanged'),
        new_items: newItems,
        orphans,
        synced: opts.sync === true && hasChanges,
        summary,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        if (!hasChanges && newItems.length === 0 && summary.source_missing === 0) {
          console.error('✓ All content is in sync.')
          return
        }

        console.error('\n📦 Content sync status\n')
        for (const entry of contentsDiff) {
          if (entry.status === 'unchanged') continue
          const icon = entry.status === 'modified' ? '  modified' : '  ⚠ source missing'
          console.error(`${icon}: ${entry.name} (${entry.type})`)
          if (entry.files) {
            for (const f of entry.files) {
              console.error(`    ${f.status}: ${f.relPath}`)
            }
          }
        }

        if (orphans.length > 0) {
          console.error('\n  \x1b[33mOnly in .relay/ (deleted from source):\x1b[0m')
          for (const orphan of orphans) {
            console.error(`    \x1b[31m✗ ${orphan}\x1b[0m`)
          }
        }

        if (newItems.length > 0) {
          console.error('\n  Newly discovered content:')
          for (const item of newItems) {
            console.error(`    + ${item.name} (${item.type}) — ${item.source}`)
          }
        }

        console.error('')
        console.error(`  Total: modified ${summary.modified}, unchanged ${summary.unchanged}, source missing ${summary.source_missing}, new ${summary.new_available}, orphaned ${summary.orphaned}`)

        if (opts.sync) {
          console.error('\n✓ Applied to .relay/')
        } else if (hasChanges) {
          console.error('\nTo apply: anpm package --sync')
        }
      }
    })
}
