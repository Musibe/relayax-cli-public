import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { API_URL, getValidToken } from '../lib/config.js'
import { generatePreamble, generatePreambleBin } from '../lib/preamble.js'
import { checkCliVersion } from '../lib/version-check.js'
import { resolveProjectPath } from '../lib/paths.js'
import { reportCliError } from '../lib/error-report.js'
import { trackCommand } from '../lib/step-tracker.js'
import { checkGitInstalled, buildGitUrl, gitPublishInit, gitPublishUpdate } from '../lib/git-operations.js'
import { generateSetupCommand } from '../lib/setup-command.js'
import { suggestRequires, formatSuggestions, mergeIntoRequires } from '../lib/requires-suggest.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cliPkg = require('../../package.json') as { version: string }

const VALID_DIRS = ['skills', 'agents', 'rules', 'commands', 'bin'] as const


interface CommandEntry {
  name: string
  description: string
}

interface Components {
  agents: number
  rules: number
  skills: number
}

export interface RequiresCli {
  name: string
  install?: string
  required?: boolean
}

export interface RequiresMcp {
  name: string
  package?: string
  required?: boolean
  config?: { command: string; args?: string[] }
  env?: string[]
}

export interface RequiresEnv {
  name: string
  required?: boolean
  description?: string
  setup_hint?: string
}

export interface RequiresNpm {
  name: string
  required?: boolean
}

export interface Requires {
  cli?: RequiresCli[]
  mcp?: RequiresMcp[]
  npm?: (string | RequiresNpm)[]
  env?: RequiresEnv[]
  agents?: string[]
  runtime?: { node?: string; python?: string }
  permissions?: string[]
}

interface AgentDetail {
  name: string
  description: string
  uses: string[]
}

interface SkillDetail {
  name: string
  description: string
  uses: string[]
}

export interface PublishMetadata {
  slug: string
  name: string
  description: string
  long_description?: string
  tags: string[]
  commands: CommandEntry[]
  components: Components  // sent as-is to API, server maps to individual columns
  version: string
  changelog?: string
  requires?: Requires
  visibility?: 'public' | 'private' | 'internal'
  type?: 'command' | 'passive' | 'hybrid'
  recommended_scope?: 'global' | 'local'
  cli_version?: string
  agent_names?: string[]
  skill_names?: string[]
  agent_details?: AgentDetail[]
  skill_details?: SkillDetail[]
  org_slug?: string
  cloud_config?: {
    supported_providers: string[]
    [provider: string]: unknown
  }
}

interface RelayYaml {
  name: string
  slug: string
  description: string
  version: string
  changelog?: string
  tags: string[]
  long_description?: string
  requires?: Requires
  visibility?: 'public' | 'private' | 'internal'
  type?: 'command' | 'passive' | 'hybrid'
  recommended_scope?: 'global' | 'local'
  source?: string
  org_slug?: string
}

function parseRelayYaml(content: string): RelayYaml {
  const raw = yaml.load(content) as Record<string, unknown> ?? {}

  const tags: string[] = Array.isArray(raw.tags)
    ? raw.tags.map((t: unknown) => String(t))
    : []

  const requires = raw.requires as Requires | undefined

  const rawVisibility = String(raw.visibility ?? '')
  const visibility: RelayYaml['visibility'] =
    rawVisibility === 'internal' ? 'internal'
    : rawVisibility === 'private' ? 'private'
    : rawVisibility === 'public' ? 'public'
    : undefined

  const rawType = String(raw.type ?? '')
  const type: RelayYaml['type'] =
    rawType === 'command' ? 'command'
    : rawType === 'passive' ? 'passive'
    : rawType === 'hybrid' ? 'hybrid'
    : undefined

  return {
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
    description: String(raw.description ?? ''),
    version: String(raw.version ?? '1.0.0'),
    changelog: raw.changelog ? String(raw.changelog) : undefined,
    long_description: raw.long_description ? String(raw.long_description) : undefined,
    tags,
    requires,
    visibility,
    type,
    recommended_scope: raw.recommended_scope === 'global' ? 'global' : raw.recommended_scope === 'local' ? 'local' : undefined,
    source: raw.source ? String(raw.source) : undefined,
    org_slug: raw.org_slug ? String(raw.org_slug) : undefined,
  }
}

function detectCommands(agentDir: string): CommandEntry[] {
  const cmdDir = path.join(agentDir, 'commands')
  if (!fs.existsSync(cmdDir)) return []

  const entries: CommandEntry[] = []
  const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    const name = path.basename(file, '.md')
    let description = name
    try {
      const content = fs.readFileSync(path.join(cmdDir, file), 'utf-8')
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines[0] === '---') {
        const endIdx = lines.indexOf('---', 1)
        if (endIdx > 0) {
          const frontmatter = lines.slice(1, endIdx).join('\n')
          const m = frontmatter.match(/^description:\s*(.+)$/m)
          if (m) description = m[1].trim()
        }
      } else if (lines[0]) {
        description = lines[0].replace(/^#+\s*/, '')
      }
    } catch {
      // ignore read errors
    }
    entries.push({ name, description })
  }

  return entries
}

function detectSkills(agentDir: string): SkillDetail[] {
  const skillsDir = path.join(agentDir, 'skills')
  if (!fs.existsSync(skillsDir)) return []

  const entries: SkillDetail[] = []
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) continue

    let description = entry.name
    const uses: string[] = []
    try {
      const content = fs.readFileSync(skillMd, 'utf-8')
      const m = content.match(/^---\n[\s\S]*?description:\s*[|>]?\s*\n?\s*(.+)\n[\s\S]*?---/m)
        ?? content.match(/^---\n[\s\S]*?description:\s*(.+)\n[\s\S]*?---/m)
      if (m) description = m[1].trim()

      // Extract allowed-tools from frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (frontmatterMatch) {
        const fm = yaml.load(frontmatterMatch[1]) as Record<string, unknown> | null
        if (fm && Array.isArray(fm['allowed-tools'])) {
          for (const tool of fm['allowed-tools'] as unknown[]) {
            const t = String(tool).trim()
            if (t) uses.push(t)
          }
        }
      }
    } catch {
      // ignore
    }
    entries.push({ name: entry.name, description, uses })
  }
  return entries
}

const MCP_KEYWORDS = ['mcp', 'supabase', 'github', 'slack', 'notion', 'linear', 'jira', 'figma', 'stripe', 'openai', 'anthropic', 'postgres', 'mysql', 'redis', 'mongodb', 'firebase', 'aws', 'gcp', 'azure', 'vercel', 'netlify', 'docker', 'kubernetes']

function detectAgentDetails(agentDir: string, requires?: Requires): AgentDetail[] {
  const agentsDir = path.join(agentDir, 'agents')
  if (!fs.existsSync(agentsDir)) return []

  const mcpNames = new Set((requires?.mcp ?? []).map((m) => m.name.toLowerCase()))
  const envNames = new Set((requires?.env ?? []).map((e) => e.name.toLowerCase()))

  const entries: AgentDetail[] = []
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    const name = path.basename(file, '.md')
    let description = name
    const uses: string[] = []

    try {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (frontmatterMatch) {
        const fm = yaml.load(frontmatterMatch[1]) as Record<string, unknown> | null
        if (fm) {
          if (typeof fm.description === 'string') description = fm.description.trim()
        }
      }

      // Scan body for MCP-related keywords
      const bodyLower = content.toLowerCase()
      for (const keyword of MCP_KEYWORDS) {
        if (bodyLower.includes(keyword) && !uses.includes(keyword)) {
          uses.push(keyword)
        }
      }

      // Cross-reference with requires.mcp and requires.env
      for (const mcp of mcpNames) {
        if (bodyLower.includes(mcp) && !uses.includes(mcp)) {
          uses.push(mcp)
        }
      }
      for (const env of envNames) {
        if (bodyLower.includes(env) && !uses.includes(env)) {
          uses.push(env)
        }
      }
    } catch {
      // ignore read errors
    }

    entries.push({ name, description, uses })
  }

  return entries
}

/**
 * Generate agent entry point command (commands/{author}-{name}.md).
 * Replaces root SKILL.md as the agent's entry point.
 */
function generateEntryCommand(
  config: { slug: string; name: string; description: string; version: string },
  commands: CommandEntry[],
  skills: { name: string; description: string }[],
  scopedSlug: string,
  agentDir: string,
): string {
  const lines: string[] = []

  // Frontmatter
  lines.push('---')
  lines.push(`description: ${config.description}`)
  lines.push('---')
  lines.push('')

  // Preamble
  lines.push(generatePreamble(scopedSlug, agentDir))
  lines.push('')

  // Agent header
  lines.push(`## ${config.name}`)
  lines.push('')
  lines.push(`v${config.version} — ${scopedSlug}`)
  lines.push('')

  // Skills
  if (skills.length > 0) {
    lines.push('### Available skills')
    lines.push('')
    for (const s of skills) {
      lines.push(`- **${s.name}**: ${s.description}`)
    }
    lines.push('')
  }

  // Commands
  if (commands.length > 0) {
    lines.push('### Available commands')
    lines.push('')
    for (const c of commands) {
      lines.push(`- **/${c.name}**: ${c.description}`)
    }
    lines.push('')
  }

  lines.push('### Getting started')
  lines.push('')
  lines.push('Tell me what you need or run any of the commands above.')
  lines.push('')

  return lines.join('\n')
}

function countDir(agentDir: string, dirName: string): number {
  const dirPath = path.join(agentDir, dirName)
  if (!fs.existsSync(dirPath)) return 0
  return fs.readdirSync(dirPath).filter((f) => !f.startsWith('.')).length
}

function listDir(agentDir: string, dirName: string): string[] {
  const dirPath = path.join(agentDir, dirName)
  if (!fs.existsSync(dirPath)) return []
  return fs.readdirSync(dirPath).filter((f) => !f.startsWith('.'))
}


/**
 * Extract cloud_config metadata from anpm.yaml for registry.
 */
function extractCloudConfig(config: RelayYaml): { cloud_config?: PublishMetadata['cloud_config'] } {
  const cloud = (config as unknown as Record<string, unknown>).cloud as Record<string, unknown> | undefined
  if (!cloud) return {}

  const providers = Object.keys(cloud).filter(k => typeof cloud[k] === 'object')
  if (providers.length === 0) return {}

  const result: Record<string, unknown> = { supported_providers: providers }

  for (const p of providers) {
    const pConfig = cloud[p] as Record<string, unknown>
    result[p] = {
      model: pConfig.model,
      has_custom_skills: fs.existsSync(path.join(process.cwd(), 'skills')) || fs.existsSync(path.join(process.cwd(), '.anpm', 'skills')),
      skill_count: listDir(process.cwd(), 'skills').length || listDir(path.join(process.cwd(), '.anpm'), 'skills').length,
    }
  }

  return { cloud_config: result as PublishMetadata['cloud_config'] }
}

/**
 * Resolve long_description.
 * 1. Use from relay.yaml if present
 * 2. Fall back to README.md
 */
function resolveLongDescription(agentDir: string, yamlValue?: string): string | undefined {
  if (yamlValue) return yamlValue

  const readmePath = path.join(agentDir, 'README.md')
  if (fs.existsSync(readmePath)) {
    try {
      return fs.readFileSync(readmePath, 'utf-8').trim() || undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

interface PublishResult {
  status: string
  slug: string
  version: string
  url: string
  access_code?: string | null
  profile?: {
    username?: string
    display_name?: string
    contact_links?: Record<string, string>
    default_welcome?: string
  } | null
}

export async function publishToApi(
  token: string,
  metadata: PublishMetadata,
): Promise<PublishResult> {
  const res = await fetch(`${API_URL}/api/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
    redirect: 'error',
  })

  const body = await res.json() as Record<string, unknown>

  if (!res.ok) {
    const msg = typeof body.message === 'string' ? body.message : `Server error (${res.status})`
    throw new Error(msg)
  }

  return body as unknown as PublishResult
}

export function registerPublish(program: Command): void {
  program
    .command('publish')
    .description('Publish current agent package to the registry (anpm.yaml required)')
    .option('--token <token>', 'Auth token')
    .option('--space <slug>', 'Target Space')
    .option('--org <slug>', 'Organization slug')
    .option('--no-org', 'Publish to personal account (skip org)')
    .option('--version <version>', 'Set version (updates anpm.yaml)')
    .option('--patch', 'Bump patch version')
    .option('--minor', 'Bump minor version')
    .option('--major', 'Bump major version')
    .option('--project <dir>', 'Project root path (default: cwd, env: ANPM_PROJECT_PATH)')
    .action(async (opts: { token?: string; space?: string; org?: string; noOrg?: boolean; version?: string; patch?: boolean; minor?: boolean; major?: boolean; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const agentDir = resolveProjectPath(opts.project)
      const relayDir = path.join(agentDir, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')
      const isTTY = Boolean(process.stdin.isTTY) && !json

      trackCommand('publish', { slug: undefined })

      // CLI update check before publish
      if (isTTY) {
        const cliUpdate = await checkCliVersion(true)
        if (cliUpdate) {
          console.error(`\n\x1b[33m⚠ anpm v${cliUpdate.latest} available\x1b[0m (current v${cliUpdate.current})`)
          console.error('  Latest version supports auto-update notifications for installers.')
          console.error(`  Update: \x1b[36mnpm update -g anpm-io\x1b[0m\n`)
        }
      }

      // Check .relay/relay.yaml exists
      if (!fs.existsSync(relayYamlPath)) {
        if (!isTTY) {
          reportCliError('publish', 'NOT_INITIALIZED', 'relay.yaml missing')
          console.error(JSON.stringify({
            error: 'NOT_INITIALIZED',
            message: '.relay/relay.yaml not found. Run `anpm create` first.',
            fix: 'Run anpm create or create anpm.yaml manually.',
          }))
          process.exit(1)
        }

        // Interactive onboarding: create relay.yaml
        const { input: promptInput, select: promptSelect } =
          await import('@inquirer/prompts')

        const dirName = path.basename(agentDir)
        const defaultSlug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

        console.error('\n\x1b[36mInitializing agent package.\x1b[0m')
        console.error('Provide some info to generate .relay/relay.yaml.\n')

        const name = await promptInput({
          message: 'Agent name:',
          default: dirName,
        })

        const slug = await promptInput({
          message: 'Slug (unique URL identifier):',
          default: defaultSlug,
        })

        const description = await promptInput({
          message: 'Agent description (required):',
          validate: (v) => v.trim().length > 0 ? true : 'Please enter a description.',
        })

        const tagsRaw = await promptInput({
          message: 'Tags (comma-separated, optional):',
          default: '',
        })

        const visibility = await promptSelect<'public' | 'private' | 'internal'>({
          message: 'Visibility:',
          choices: [
            { name: 'Public — anyone can discover and install', value: 'public' },
            { name: 'Private — only authorized users with an access code', value: 'private' },
            { name: 'Internal — anyone in the organization', value: 'internal' },
          ],
        })

        if (visibility === 'private') {
          console.error('\x1b[2m💡 Manage authorized users for private agents at: www.anpm.io/dashboard\x1b[0m')
        } else if (visibility === 'internal') {
          console.error('\x1b[2m💡 Internal agents are available to all org members: www.anpm.io/dashboard/agents\x1b[0m')
        }
        console.error('')

        const tags = tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)

        const yamlData: Record<string, unknown> = {
          name,
          slug,
          description,
          version: '1.0.0',
          tags,
          visibility,
        }
        fs.mkdirSync(relayDir, { recursive: true })
        fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
        console.error(`\n\x1b[32m✓ .relay/relay.yaml created.\x1b[0m\n`)
      }

      // Parse relay.yaml
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = parseRelayYaml(yamlContent)

      if (!config.slug || !config.name || !config.description) {
        reportCliError('publish', 'INVALID_CONFIG', 'missing name/slug/description')
        console.error(JSON.stringify({
          error: 'INVALID_CONFIG',
          message: 'anpm.yaml requires name, slug, and description.',
          fix: 'Check name, slug, and description in anpm.yaml.',
        }))
        process.exit(1)
      }

      // Version bump: --version flag takes priority, then --patch/--minor/--major
      const hasBumpFlag = Boolean(opts.patch || opts.minor || opts.major)
      if (opts.version) {
        config.version = opts.version
        const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
        yamlData.version = opts.version
        fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
      } else if (hasBumpFlag) {
        const [major, minor, patch] = config.version.split('.').map(Number)
        let newVersion: string
        if (opts.major) {
          newVersion = `${major + 1}.0.0`
        } else if (opts.minor) {
          newVersion = `${major}.${minor + 1}.0`
        } else {
          newVersion = `${major}.${minor}.${patch + 1}`
        }
        config.version = newVersion
        const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
        yamlData.version = newVersion
        fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
        if (!json) {
          console.error(`  → Saved version: ${newVersion} to anpm.yaml\n`)
        }
      } else if (isTTY) {
        const { select: promptVersion } = await import('@inquirer/prompts')
        const [major, minor, patch] = config.version.split('.').map(Number)
        const bumpPatch = `${major}.${minor}.${patch + 1}`
        const bumpMinor = `${major}.${minor + 1}.0`
        const bumpMajor = `${major + 1}.0.0`

        const newVersion = await promptVersion<string>({
          message: `Version (current v${config.version}):`,
          choices: [
            { name: `v${bumpPatch} — patch (bug fix)`, value: bumpPatch },
            { name: `v${bumpMinor} — minor (new feature)`, value: bumpMinor },
            { name: `v${bumpMajor} — major (breaking change)`, value: bumpMajor },
            { name: `v${config.version} — keep`, value: config.version },
          ],
        })

        if (newVersion !== config.version) {
          config.version = newVersion
          const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
          yamlData.version = newVersion
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → Saved version: ${newVersion} to anpm.yaml\n`)
        }
      }

      // Auto-sync: sync contents defined in relay.yaml to .relay/
      try {
        const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
        const yamlConfig = yaml.load(yamlContent) as Record<string, unknown>
        const contents = (yamlConfig.contents as unknown[]) ?? []
        if (contents.length > 0) {
          const { computeContentsDiff, syncContentsToRelay } = await import('./package.js')
          const { diff: contentsDiff } = computeContentsDiff(contents as Parameters<typeof computeContentsDiff>[0], relayDir, agentDir)
          const hasChanges = contentsDiff.some((d: { status: string }) => d.status === 'modified')
          if (hasChanges) {
            syncContentsToRelay(contents as Parameters<typeof syncContentsToRelay>[0], contentsDiff as Parameters<typeof syncContentsToRelay>[1], relayDir, agentDir)
            if (!json) {
              const changedNames = contentsDiff.filter((d: { status: string }) => d.status === 'modified').map((d: { name: string }) => d.name)
              console.error(`\x1b[36m⚙ Source sync:\x1b[0m ${changedNames.join(', ')}`)
            }
          }
        }
      } catch {
        // sync failure is non-fatal — continue with existing .relay/ contents
      }

      // Validate structure (contents are in .relay/)
      const hasDirs = VALID_DIRS.some((d) => {
        const dirPath = path.join(relayDir, d)
        if (!fs.existsSync(dirPath)) return false
        return fs.readdirSync(dirPath).filter((f) => !f.startsWith('.')).length > 0
      })
      if (!hasDirs) {
        reportCliError('publish', 'EMPTY_PACKAGE', 'no content dirs found')
        console.error(JSON.stringify({
          error: 'EMPTY_PACKAGE',
          message: '.relay/ must contain files in at least one of: skills/, agents/, rules/, commands/.',
          fix: 'Add files to one of: .relay/skills/, .relay/agents/, .relay/rules/, .relay/commands/.',
        }))
        process.exit(1)
      }

      // Get token (checked before tarball creation)
      const token = opts.token ?? process.env.ANPM_TOKEN ?? process.env.RELAY_TOKEN ?? await getValidToken()
      if (!token) {
        reportCliError('publish', 'NO_TOKEN', 'auth required')
        console.error(JSON.stringify({
          error: 'NO_TOKEN',
          message: 'Authentication required. Run `anpm login` first.',
          fix: 'Run anpm login and try again.',
        }))
        process.exit(1)
      }

      // Fetch user's Orgs and select publish target
      let selectedOrgId: string | undefined
      let selectedOrgSlug: string | undefined
      try {
        const { fetchMyOrgs } = await import('./orgs.js')
        const orgs = await fetchMyOrgs(token)

        // --no-org: skip org selection entirely (personal deployment)
        const skipOrg = opts.noOrg === true

        // Determine explicit org slug: --org > --space (legacy) > relay.yaml org_slug
        const explicitOrgSlug = skipOrg ? undefined : (opts.org ?? opts.space ?? config.org_slug)

        // --org / --space / relay.yaml org_slug: resolve Org by slug
        if (skipOrg) {
          // Personal deployment — no org
          if (!json) {
            console.error('\x1b[2m  Publishing to personal account.\x1b[0m\n')
          }
        } else if (explicitOrgSlug) {
          const matched = orgs.find((o) => o.slug === explicitOrgSlug)
          if (matched) {
            selectedOrgId = matched.id
            selectedOrgSlug = matched.slug
            if (!json && (opts.org || config.org_slug)) {
              console.error(`\x1b[2m  Organization: ${matched.name} (${matched.slug})\x1b[0m\n`)
            }
          } else {
            if (json) {
              console.error(JSON.stringify({
                error: 'INVALID_ORG',
                message: `Organization '${explicitOrgSlug}' not found.`,
                fix: `Available orgs: ${orgs.map((o) => o.slug).join(', ')}`,
                options: orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` })),
              }))
            } else {
              console.error(`Organization '${explicitOrgSlug}' not found.`)
            }
            reportCliError('publish', 'INVALID_ORG', `org:${explicitOrgSlug}`)
            process.exit(1)
          }
        } else if (isTTY) {
          if (orgs.length === 0) {
            // No orgs — publish without org_id
            console.error('\x1b[33m⚠ No organizations found. Publishing to personal account.\x1b[0m\n')
          } else if (orgs.length === 1) {
            // Only one Org — auto-select
            selectedOrgId = orgs[0].id
            selectedOrgSlug = orgs[0].slug
            console.error(`\x1b[2m  Organization: ${orgs[0].name} (${orgs[0].slug})\x1b[0m\n`)
          } else {
            // Multiple orgs — prompt user
            const { select: selectOrg } = await import('@inquirer/prompts')
            const orgChoices = orgs.map((o) => ({
              name: `${o.name} (${o.slug})`,
              value: o.id,
              slug: o.slug,
            }))
            const chosenId = await selectOrg<string>({
              message: 'Which organization to publish to?',
              choices: orgChoices.map((c) => ({ name: c.name, value: c.value })),
            })
            const chosen = orgChoices.find((c) => c.value === chosenId)
            selectedOrgId = chosenId
            selectedOrgSlug = chosen?.slug
            const chosenLabel = chosen?.name ?? chosenId
            console.error(`  → Organization: ${chosenLabel}\n`)
          }
        } else if (orgs.length > 0 && json) {
          // --json mode + Org available: return error so agent can choose
          reportCliError('publish', 'MISSING_ORG', `${orgs.length} orgs, none selected`)
          console.error(JSON.stringify({
            error: 'MISSING_ORG',
            message: 'Select publish target.',
            fix: `Personal: anpm publish --no-org --json / Org: anpm publish --org <slug> --json`,
            options: [
              { value: '__personal__', label: 'Publish to personal account' },
              ...orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` })),
            ],
          }))
          process.exit(1)
        } else if (orgs.length > 0) {
          // non-json, non-TTY fallback (rare) — auto-select first org
          selectedOrgId = orgs[0].id
          selectedOrgSlug = orgs[0].slug
        }
      } catch {
        // Ignore org fetch failure and continue
      }

      // Visibility default
      const defaultVisibility: 'public' | 'private' = 'public'

      // Visibility validation: must be explicitly set
      // internal is only shown when org is selected
      const hasOrg = !!selectedOrgId
      if (!config.visibility) {
        if (isTTY) {
          const { select: promptSelect } = await import('@inquirer/prompts')
          console.error(`\n\x1b[33m⚠ visibility not set in anpm.yaml.\x1b[0m  (default: ${defaultVisibility})`)

          const visChoices: { name: string; value: 'public' | 'private' | 'internal' }[] = hasOrg
            ? [
              {
                name: `Public — anyone outside the org can use${defaultVisibility === 'public' ? '  ✓ recommended' : ''}`,
                value: 'public',
              },
              {
                name: 'Private — only authorized org members',
                value: 'private',
              },
            ]
            : [
              {
                name: `Public — anyone can discover and install${defaultVisibility === 'public' ? '  ✓ recommended' : ''}`,
                value: 'public',
              },
              {
                name: 'Private — only authorized users with an access code',
                value: 'private',
              },
            ]
          if (hasOrg) {
            visChoices.push({
              name: 'Internal — anyone in the organization',
              value: 'internal',
            })
          }

          config.visibility = await promptSelect<'public' | 'private' | 'internal'>({
            message: 'Select visibility:',
            choices: visChoices,
            default: defaultVisibility,
          })
          // Save back to relay.yaml
          const yamlData = yaml.load(yamlContent) as Record<string, unknown>
          yamlData.visibility = config.visibility
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → Saved visibility: ${config.visibility} to anpm.yaml\n`)
        } else {
          reportCliError('publish', 'MISSING_VISIBILITY', 'visibility not set in relay.yaml')
          const visOptions: { value: string; label: string }[] = hasOrg
            ? [
              { value: 'public', label: 'Public — anyone outside the org can use' },
              { value: 'private', label: 'Private — only authorized org members' },
            ]
            : [
              { value: 'public', label: 'Public — anyone can discover and install' },
              { value: 'private', label: 'Private — only authorized users with an access code' },
            ]
          if (hasOrg) {
            visOptions.push({ value: 'internal', label: 'Internal — anyone in the organization' })
          }
          console.error(JSON.stringify({
            error: 'MISSING_VISIBILITY',
            message: 'Please set visibility in anpm.yaml.',
            options: visOptions,
            fix: 'Set the visibility field in relay.yaml to one of the options above.',
          }))
          process.exit(1)
        }
      }

      // Confirm visibility before publish (allow change on re-publish)
      // Skip when a bump flag is present and visibility is already set in relay.yaml
      if (isTTY && !hasBumpFlag) {
        const { select: promptConfirmVis } = await import('@inquirer/prompts')
        const visLabelMap: Record<string, string> = {
          public: 'public',
          private: 'private',
          internal: 'internal',
        }
        const currentVisLabel = visLabelMap[config.visibility ?? 'public'] ?? config.visibility

        const currentVis = config.visibility ?? defaultVisibility
        const confirmVisChoices: { name: string; value: 'public' | 'private' | 'internal' }[] = [
          {
            name: `Keep ${currentVisLabel}`,
            value: currentVis as 'public' | 'private' | 'internal',
          },
        ]
        // Add remaining options (excluding current value)
        if (currentVis !== 'public') {
          confirmVisChoices.push({
            name: hasOrg ? 'Public — anyone outside the org can use' : 'Public — anyone can discover and install',
            value: 'public',
          })
        }
        if (currentVis !== 'private') {
          confirmVisChoices.push({
            name: hasOrg ? 'Private — only authorized org members' : 'Private — only authorized users with an access code',
            value: 'private',
          })
        }
        if (hasOrg && currentVis !== 'internal') {
          confirmVisChoices.push({
            name: 'Internal — anyone in the organization',
            value: 'internal',
          })
        }

        const newVisibility = await promptConfirmVis<'public' | 'private' | 'internal'>({
          message: `Visibility: ${currentVisLabel}`,
          choices: confirmVisChoices,
          default: currentVis,
        })

        if (newVisibility !== config.visibility) {
          config.visibility = newVisibility
          const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
          yamlData.visibility = config.visibility
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → Saved visibility: ${config.visibility} (${visLabelMap[config.visibility]}) to anpm.yaml\n`)
        }
      }

      // ── Auto-detect + suggest requires ──
      if (isTTY && !json) {
        const suggestions = suggestRequires(relayDir, config.requires)
        if (suggestions.length > 0) {
          console.error('\n\x1b[33m⚡ Missing requires detected:\x1b[0m')
          for (const line of formatSuggestions(suggestions)) {
            console.error(line)
          }
          const { confirm } = await import('@inquirer/prompts')
          const addThem = await confirm({
            message: 'Add to requires?',
            default: true,
          })
          if (addThem) {
            config.requires = mergeIntoRequires(config.requires ?? {}, suggestions)
            const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
            yamlData.requires = config.requires
            fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
            console.error('  → Updated requires in anpm.yaml\n')
          }
        }
      }

      // Generate setup command BEFORE detectCommands so it's included in metadata
      {
        const commandsDir = path.join(relayDir, 'commands')
        if (!fs.existsSync(commandsDir)) {
          fs.mkdirSync(commandsDir, { recursive: true })
        }
        const slugName = config.slug.split('/').pop() ?? config.name
        const setupContent = generateSetupCommand(config.name, config.requires, slugName)
        if (setupContent) {
          const setupFileName = `setup-${slugName}.md`
          fs.writeFileSync(path.join(commandsDir, setupFileName), setupContent)
        }
      }

      const detectedCommands = detectCommands(relayDir)
      const components: Components = {
        agents: countDir(relayDir, 'agents'),
        rules: countDir(relayDir, 'rules'),
        skills: countDir(relayDir, 'skills'),
      }

      const longDescription = resolveLongDescription(relayDir, config.long_description)

      const detectedSkills = detectSkills(relayDir)
      const detectedAgents = detectAgentDetails(relayDir, config.requires)

      const metadata: PublishMetadata = {
        slug: config.slug,
        name: config.name,
        description: config.description,
        long_description: longDescription,
        tags: config.tags,
        commands: detectedCommands,
        components,
        version: config.version,
        changelog: config.changelog,
        requires: config.requires,
        visibility: config.visibility,
        cli_version: cliPkg.version,
        agent_names: listDir(relayDir, 'agents'),
        skill_names: listDir(relayDir, 'skills'),
        type: config.type ?? 'hybrid',
        recommended_scope: config.recommended_scope,
        agent_details: detectedAgents,
        skill_details: detectedSkills,
        ...(selectedOrgId ? { org_id: selectedOrgId } : {}),
        ...(selectedOrgSlug ? { org_slug: selectedOrgSlug } : {}),
        ...extractCloudConfig(config),
      }

      if (!json) {
        console.error(`Building package... (${config.name} v${config.version})`)
      }

      // Generate bin/relay-preamble.sh (self-contained tracking + update check)
      generatePreambleBin(relayDir, config.slug, API_URL)

      // Generate entry command (commands/{author}-{name}.md)
      const entryContent = generateEntryCommand(
        config,
        detectedCommands,
        detectedSkills,
        config.slug,
        relayDir,
      )
      const commandsDir = path.join(relayDir, 'commands')
      if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true })
      }
      // slug: @alice/cardnews → alice-cardnews.md
      const entrySlug = config.slug.startsWith('@') ? config.slug.slice(1) : config.slug
      const entryFileName = entrySlug.replace('/', '-') + '.md'
      fs.writeFileSync(path.join(commandsDir, entryFileName), entryContent)

      // Check git is available
      try {
        checkGitInstalled()
      } catch (gitErr) {
        const gitMsg = gitErr instanceof Error ? gitErr.message : String(gitErr)
        reportCliError('publish', 'GIT_NOT_FOUND', gitMsg)
        if (json) {
          console.error(JSON.stringify({ error: 'GIT_NOT_FOUND', message: gitMsg }))
        } else {
          console.error(`\x1b[31m${gitMsg}\x1b[0m`)
        }
        process.exit(1)
      }

      try {
        if (!json) {
          console.error(`Uploading...`)
        }

        const result = await publishToApi(token, metadata)

        // Git push: commit and push to git server (required)
        const gitUrlRaw = (result as unknown as Record<string, unknown>).git_url as string | undefined
        if (gitUrlRaw) {
          const gitUrl = buildGitUrl(gitUrlRaw, { token })
          if (!json) {
            console.error('Pushing to git repository...')
          }
          try {
            const isFirstPublish = !(result as unknown as Record<string, unknown>).is_update
            if (isFirstPublish) {
              await gitPublishInit(relayDir, gitUrl, config.version)
            } else {
              await gitPublishUpdate(relayDir, gitUrl, config.version)
            }
          } catch (gitPushErr) {
            const gpMsg = gitPushErr instanceof Error ? gitPushErr.message : String(gitPushErr)
            if (json) {
              console.log(JSON.stringify({ error: 'GIT_PUSH_FAILED', message: `git push failed: ${gpMsg}` }))
            } else {
              console.error(`\x1b[31m✖ git push failed: ${gpMsg}\x1b[0m`)
              console.error('\x1b[33m  To retry, run anpm publish again.\x1b[0m')
            }
            process.exit(1)
          }
        }

        // Update entry command preamble with scoped slug from server (non-fatal)
        try {
          if (result.slug && result.slug !== config.slug) {
            const serverSlug = result.slug.startsWith('@') ? result.slug.slice(1) : result.slug
            const entryFile = path.join(relayDir, 'commands', serverSlug.replace('/', '-') + '.md')
            if (fs.existsSync(entryFile)) {
              const { injectPreamble } = await import('../lib/preamble.js')
              injectPreamble(entryFile, result.slug, relayDir)
            }
          }
        } catch {
          // preamble update is best-effort — publish already succeeded
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          console.log(`\n\x1b[32m✓ ${config.name} published\x1b[0m  v${result.version}`)
          console.log(`  slug: \x1b[36m${result.slug}\x1b[0m`)
          console.log(`  URL:    \x1b[36m${result.url}\x1b[0m`)

          // Build share block
          {
            const detailSlug = result.slug.startsWith('@') ? result.slug.slice(1) : result.slug
            const accessCode = result.access_code ?? null

            // npx turnkey install command (works everywhere, no pre-install needed)
            const visibility = config.visibility ?? 'public'
            let npxInstallCmd: string
            if ((visibility === 'internal' || visibility === 'private') && accessCode) {
              npxInstallCmd = `npx anpm-io install ${result.slug} --code ${accessCode}`
            } else {
              npxInstallCmd = `npx anpm-io install ${result.slug}`
            }

            // ── Share text (box, ready to copy-paste) ──
            if (isTTY) {
              const shareBlock = [
                `[${config.name}] Install`,
                ``,
                npxInstallCmd,
                ``,
                `Info: https://anpm.io/@${detailSlug}`,
              ]

              const maxLen = Math.max(...shareBlock.map((l) => l.length))
              const border = '─'.repeat(maxLen + 2)
              console.log(`\n  \x1b[90m┌${border}┐\x1b[0m`)
              for (const line of shareBlock) {
                const pad = ' '.repeat(maxLen - line.length)
                console.log(`  \x1b[90m│\x1b[0m ${line}${pad} \x1b[90m│\x1b[0m`)
              }
              console.log(`  \x1b[90m└${border}┘\x1b[0m`)
              console.log(`  \x1b[90m↑ Share with your team\x1b[0m`)
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportCliError('publish', 'PUBLISH_FAILED', message)
        console.error(JSON.stringify({ error: 'PUBLISH_FAILED', message, fix: message }))
        process.exit(1)
      }
    })
}
