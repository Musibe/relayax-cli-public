import fs from 'fs'
import path from 'path'

export interface ManifestAgents {
  [slug: string]: string // version range: "^2.0", "~1.5", "*", "1.2.3"
}

export interface RelayManifest {
  // Builder fields (existing)
  name?: string
  version?: string
  slug?: string
  requires?: Record<string, unknown>
  // User fields
  agents?: ManifestAgents
  // v2: Provider-neutral agent definition
  agent?: {
    system?: string
    tools?: string[]
    skills?: { name: string }[]
    mcp_servers?: { name: string; url?: string }[]
  }
  // v2: Local harness config (explicit namespace for existing top-level fields)
  local?: {
    commands?: { name: string; description?: string }[]
    scope?: 'global' | 'local'
    harnesses?: string[]
  }
  // v2: Cloud provider configs
  cloud?: {
    anthropic?: {
      model: string
      networking?: 'unrestricted' | 'limited'
      allowed_hosts?: string[]
    }
    [provider: string]: unknown
  }
  // Pass-through
  [key: string]: unknown
}

/**
 * Find and load anpm.yaml from project.
 * Search order: anpm.yaml → .anpm/anpm.yaml
 * (relay.yaml is auto-migrated to anpm.yaml on first run)
 */
export function loadManifest(projectPath: string): { manifest: RelayManifest | null; filePath: string | null } {
  const anpmRoot = path.join(projectPath, 'anpm.yaml')
  const dotAnpmPath = path.join(projectPath, '.anpm', 'anpm.yaml')

  let filePath: string | null = null

  if (fs.existsSync(anpmRoot)) {
    filePath = anpmRoot
  } else if (fs.existsSync(dotAnpmPath)) {
    filePath = dotAnpmPath
  }

  if (!filePath) return { manifest: null, filePath: null }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml') as { load: (s: string) => unknown }
    const content = fs.readFileSync(filePath, 'utf-8')
    const raw = yaml.load(content) as RelayManifest | null
    return { manifest: raw ?? {}, filePath }
  } catch {
    return { manifest: null, filePath }
  }
}

/**
 * Save agents field to relay.yaml.
 * Creates the file if it doesn't exist.
 */
export function saveManifestAgents(projectPath: string, agents: ManifestAgents): string {
  const { filePath: existingPath } = loadManifest(projectPath)
  const targetPath = existingPath ?? path.join(projectPath, 'anpm.yaml')

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const yaml = require('js-yaml') as { load: (s: string) => unknown; dump: (o: unknown, opts?: Record<string, unknown>) => string }

  let manifest: RelayManifest = {}
  if (fs.existsSync(targetPath)) {
    try {
      manifest = (yaml.load(fs.readFileSync(targetPath, 'utf-8')) as RelayManifest) ?? {}
    } catch { /* start fresh */ }
  }

  manifest.agents = agents

  const dir = path.dirname(targetPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(targetPath, yaml.dump(manifest, { lineWidth: -1 }))
  return targetPath
}

/**
 * Add an agent to relay.yaml agents field.
 */
export function addAgentToManifest(projectPath: string, slug: string, versionRange: string): void {
  const { manifest } = loadManifest(projectPath)
  const agents = manifest?.agents ?? {}
  agents[slug] = versionRange
  saveManifestAgents(projectPath, agents)
}

/**
 * Remove an agent from relay.yaml agents field.
 */
export function removeAgentFromManifest(projectPath: string, slug: string): void {
  const { manifest } = loadManifest(projectPath)
  if (!manifest?.agents) return
  delete manifest.agents[slug]
  saveManifestAgents(projectPath, manifest.agents)
}

// ─── Semver Range Matching (lightweight) ───

/**
 * Check if a version satisfies a range.
 * Supports: *, ^major.minor, ~major.minor.patch, exact
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (range === '*') return true

  const vParts = version.split('.').map(Number)
  const clean = range.replace(/^[~^]/, '')
  const rParts = clean.split('.').map(Number)

  if (range.startsWith('^')) {
    // ^major.minor — same major, >= minor
    return vParts[0] === rParts[0] && compareVersions(vParts, rParts) >= 0
  }

  if (range.startsWith('~')) {
    // ~major.minor.patch — same major.minor, >= patch
    return vParts[0] === rParts[0] && vParts[1] === rParts[1] && compareVersions(vParts, rParts) >= 0
  }

  // Exact match
  return version === range
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const na = a[i] ?? 0
    const nb = b[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}
