import fs from 'fs'
import path from 'path'

// ─── Types ───

export interface GeneratedFile {
  relativePath: string  // e.g. ".claude-plugin/plugin.json"
  content: string
}

export interface ManifestRelayYaml {
  name: string
  slug: string
  description: string
  version: string
  source?: string
  org_slug?: string
  platforms?: string[]
}

export const SUPPORTED_PLATFORMS = ['claude-code', 'codex', 'antigravity'] as const
export type Platform = typeof SUPPORTED_PLATFORMS[number]

// ─── Claude Code Generator ───

function generateClaudeCodeManifest(yaml: ManifestRelayYaml, agentDir: string): GeneratedFile[] {
  const files: GeneratedFile[] = []

  // .claude-plugin/plugin.json
  const pluginJson: Record<string, unknown> = {
    name: yaml.slug.replace(/^@/, ''),
    description: yaml.description,
    version: yaml.version,
  }
  if (yaml.source) {
    pluginJson.repository = yaml.source
  }
  if (yaml.org_slug) {
    pluginJson.author = { name: yaml.org_slug }
  }

  files.push({
    relativePath: '.claude-plugin/plugin.json',
    content: JSON.stringify(pluginJson, null, 2),
  })

  // marketplace.json (self-contained marketplace with single plugin entry)
  const slug = yaml.slug.startsWith('@') ? yaml.slug.slice(1) : yaml.slug
  const parts = slug.split('/')
  const owner = parts[0] ?? slug
  const pluginName = parts[1] ?? slug

  const marketplaceJson = {
    name: `@${slug}`,
    owner: { name: owner },
    plugins: [
      {
        name: pluginName,
        source: {
          source: 'url',
          url: './',
        },
        version: yaml.version,
      },
    ],
  }

  files.push({
    relativePath: 'marketplace.json',
    content: JSON.stringify(marketplaceJson, null, 2),
  })

  return files
}

// ─── Codex Generator ───

function generateCodexManifest(yaml: ManifestRelayYaml, agentDir: string): GeneratedFile[] {
  const pluginJson: Record<string, unknown> = {
    name: yaml.slug.replace(/^@/, ''),
    description: yaml.description,
    version: yaml.version,
  }

  // Check if skills/ directory exists
  const skillsDir = path.join(agentDir, 'skills')
  if (fs.existsSync(skillsDir)) {
    pluginJson.skills = './skills/'
  }

  return [
    {
      relativePath: '.codex-plugin/plugin.json',
      content: JSON.stringify(pluginJson, null, 2),
    },
  ]
}

// ─── Antigravity Generator ───

function generateAntigravityManifest(yaml: ManifestRelayYaml, agentDir: string): GeneratedFile[] {
  // Antigravity uses .agent/skills/ structure
  // Only generate if skills/ directory exists
  const skillsDir = path.join(agentDir, 'skills')
  if (!fs.existsSync(skillsDir)) {
    return []
  }

  // Map skills/ to .agent/skills/ — no content changes, just path mapping
  const files: GeneratedFile[] = []
  const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true })

  for (const entry of skillEntries) {
    if (entry.isDirectory()) {
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
      if (fs.existsSync(skillMd)) {
        const content = fs.readFileSync(skillMd, 'utf-8')
        files.push({
          relativePath: `.agent/skills/${entry.name}/SKILL.md`,
          content,
        })
      }
    }
  }

  return files
}

// ─── Platform Registry ───

const GENERATORS: Record<Platform, (yaml: ManifestRelayYaml, agentDir: string) => GeneratedFile[]> = {
  'claude-code': generateClaudeCodeManifest,
  'codex': generateCodexManifest,
  'antigravity': generateAntigravityManifest,
}

// ─── Public API ───

/**
 * Generate platform-native manifests from relay.yaml metadata.
 * Used by both `relay publish` and `relay export`.
 */
export function generateManifests(yaml: ManifestRelayYaml, agentDir: string): GeneratedFile[] {
  const platforms = resolvePlatforms(yaml.platforms)
  const files: GeneratedFile[] = []

  for (const platform of platforms) {
    const generator = GENERATORS[platform]
    if (generator) {
      try {
        files.push(...generator(yaml, agentDir))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`\x1b[33m⚠ ${platform} 매니페스트 생성 실패: ${msg}\x1b[0m`)
      }
    }
  }

  return files
}

/**
 * Resolve platforms list: filter valid platforms, warn on invalid ones.
 */
function resolvePlatforms(platforms?: string[]): Platform[] {
  if (!platforms || platforms.length === 0) {
    return [...SUPPORTED_PLATFORMS]
  }

  const valid: Platform[] = []
  for (const p of platforms) {
    if (SUPPORTED_PLATFORMS.includes(p as Platform)) {
      valid.push(p as Platform)
    } else {
      console.error(`\x1b[33m⚠ 지원하지 않는 플랫폼: ${p} (지원: ${SUPPORTED_PLATFORMS.join(', ')})\x1b[0m`)
    }
  }

  return valid
}
