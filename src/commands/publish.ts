import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { create as tarCreate } from 'tar'
import { API_URL, getValidToken } from '../lib/config.js'
import { generatePreamble, generatePreambleBin } from '../lib/preamble.js'
import { checkCliVersion } from '../lib/version-check.js'
import { resolveProjectPath } from '../lib/paths.js'
import { reportCliError } from '../lib/error-report.js'
import { trackCommand } from '../lib/step-tracker.js'
import { checkGitInstalled, gitPublishInit, gitPublishUpdate } from '../lib/git-operations.js'
import { generateManifests } from '../lib/manifest-generator.js'
import type { ManifestRelayYaml } from '../lib/manifest-generator.js'
// GUIDE_INSTRUCTION removed — share text now uses npx install command directly

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
  cli_version?: string
  agent_names?: string[]
  skill_names?: string[]
  agent_details?: AgentDetail[]
  skill_details?: SkillDetail[]
  org_slug?: string
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
  source?: string
  org_slug?: string
  platforms?: string[]
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
    source: raw.source ? String(raw.source) : undefined,
    org_slug: raw.org_slug ? String(raw.org_slug) : undefined,
    platforms: Array.isArray(raw.platforms) ? raw.platforms.map((p: unknown) => String(p)) : undefined,
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
 * 에이전트 진입점 커맨드(commands/{author}-{name}.md)를 생성한다.
 * root SKILL.md를 대체하여 에이전트의 얼굴 역할을 한다.
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
    lines.push('### 사용 가능한 스킬')
    lines.push('')
    for (const s of skills) {
      lines.push(`- **${s.name}**: ${s.description}`)
    }
    lines.push('')
  }

  // Commands
  if (commands.length > 0) {
    lines.push('### 사용 가능한 커맨드')
    lines.push('')
    for (const c of commands) {
      lines.push(`- **/${c.name}**: ${c.description}`)
    }
    lines.push('')
  }

  lines.push('### 시작')
  lines.push('')
  lines.push('원하는 작업을 말하거나 위 커맨드를 직접 실행하세요.')
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
 * long_description을 결정한다.
 * 1. relay.yaml에 있으면 사용
 * 2. README.md가 있으면 fallback
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

export async function createTarball(agentDir: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `relay-publish-${Date.now()}.tar.gz`)

  const dirsToInclude = VALID_DIRS.filter((d) =>
    fs.existsSync(path.join(agentDir, d))
  )

  // Include root-level files if they exist
  const entries: string[] = [...dirsToInclude]
  const rootFiles = ['relay.yaml', 'SKILL.md', 'guide.md']
  for (const file of rootFiles) {
    if (fs.existsSync(path.join(agentDir, file))) {
      entries.push(file)
    }
  }

  await tarCreate(
    {
      gzip: true,
      file: tmpFile,
      cwd: agentDir,
    },
    entries
  )

  return tmpFile
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
  tarPath: string,
  metadata: PublishMetadata,
): Promise<PublishResult> {
  const fileBuffer = fs.readFileSync(tarPath)
  const blob = new Blob([fileBuffer], { type: 'application/gzip' })

  const form = new FormData()
  form.append('package', blob, `${metadata.slug}-${metadata.version}.tar.gz`)
  form.append('metadata', JSON.stringify(metadata))

  const res = await fetch(`${API_URL}/api/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    redirect: 'error',
  })

  const body = await res.json() as Record<string, unknown>

  if (!res.ok) {
    const msg = typeof body.message === 'string' ? body.message : `서버 오류 (${res.status})`
    throw new Error(msg)
  }

  return body as unknown as PublishResult
}

export function registerPublish(program: Command): void {
  program
    .command('publish')
    .description('현재 에이전트 패키지를 Space에 배포합니다 (relay.yaml 필요)')
    .option('--token <token>', '인증 토큰')
    .option('--space <slug>', '배포할 Space 지정')
    .option('--org <slug>', 'Organization slug 지정')
    .option('--version <version>', '배포 버전 지정 (relay.yaml 업데이트)')
    .option('--patch', 'patch 버전 범프')
    .option('--minor', 'minor 버전 범프')
    .option('--major', 'major 버전 범프')
    .option('--project <dir>', '프로젝트 루트 경로 (기본: cwd, 환경변수: RELAY_PROJECT_PATH)')
    .action(async (opts: { token?: string; space?: string; org?: string; version?: string; patch?: boolean; minor?: boolean; major?: boolean; project?: string }) => {
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
          console.error(`\n\x1b[33m⚠ relay v${cliUpdate.latest}이 있습니다\x1b[0m (현재 v${cliUpdate.current})`)
          console.error('  최신 버전에서는 설치자에게 자동 업데이트 알림이 지원됩니다.')
          console.error(`  업데이트: \x1b[36mnpm update -g relayax-cli\x1b[0m\n`)
        }
      }

      // Check .relay/relay.yaml exists
      if (!fs.existsSync(relayYamlPath)) {
        if (!isTTY) {
          reportCliError('publish', 'NOT_INITIALIZED', 'relay.yaml missing')
          console.error(JSON.stringify({
            error: 'NOT_INITIALIZED',
            message: '.relay/relay.yaml이 없습니다. 먼저 `relay create`를 실행하세요.',
            fix: 'relay create 또는 .relay/relay.yaml을 생성하세요.',
          }))
          process.exit(1)
        }

        // Interactive onboarding: create relay.yaml
        const { input: promptInput, select: promptSelect } =
          await import('@inquirer/prompts')

        const dirName = path.basename(agentDir)
        const defaultSlug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

        console.error('\n\x1b[36m릴레이 에이전트 패키지를 초기화합니다.\x1b[0m')
        console.error('.relay/relay.yaml을 생성하기 위해 몇 가지 정보를 입력해주세요.\n')

        const name = await promptInput({
          message: '에이전트 이름:',
          default: dirName,
        })

        const slug = await promptInput({
          message: '슬러그 (URL에 사용되는 고유 식별자):',
          default: defaultSlug,
        })

        const description = await promptInput({
          message: '에이전트 설명 (필수):',
          validate: (v) => v.trim().length > 0 ? true : '설명을 입력해주세요.',
        })

        const tagsRaw = await promptInput({
          message: '태그 (쉼표로 구분, 선택):',
          default: '',
        })

        const visibility = await promptSelect<'public' | 'private' | 'internal'>({
          message: '공개 범위:',
          choices: [
            { name: '공개 — 누구나 설치', value: 'public' },
            { name: '링크 공유 — 접근 링크가 있는 사람만 설치', value: 'private' },
            { name: '비공개 — Org 멤버만', value: 'internal' },
          ],
        })

        if (visibility === 'private') {
          console.error('\x1b[2m💡 링크 공유 에이전트는 웹 대시보드에서 접근 링크와 구매 안내를 설정하세요: www.relayax.com/dashboard\x1b[0m')
        } else if (visibility === 'internal') {
          console.error('\x1b[2m💡 비공개 에이전트는 Org를 통해 멤버를 관리하세요: www.relayax.com/dashboard/agents\x1b[0m')
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
        console.error(`\n\x1b[32m✓ .relay/relay.yaml이 생성되었습니다.\x1b[0m\n`)
      }

      // Parse relay.yaml
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = parseRelayYaml(yamlContent)

      if (!config.slug || !config.name || !config.description) {
        reportCliError('publish', 'INVALID_CONFIG', 'missing name/slug/description')
        console.error(JSON.stringify({
          error: 'INVALID_CONFIG',
          message: 'relay.yaml에 name, slug, description이 필요합니다.',
          fix: 'relay.yaml에 name, slug, description을 확인하세요.',
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
          console.error(`  → relay.yaml에 version: ${newVersion} 저장됨\n`)
        }
      } else if (isTTY) {
        const { select: promptVersion } = await import('@inquirer/prompts')
        const [major, minor, patch] = config.version.split('.').map(Number)
        const bumpPatch = `${major}.${minor}.${patch + 1}`
        const bumpMinor = `${major}.${minor + 1}.0`
        const bumpMajor = `${major + 1}.0.0`

        const newVersion = await promptVersion<string>({
          message: `버전 (현재 v${config.version}):`,
          choices: [
            { name: `v${bumpPatch} — patch (버그 수정)`, value: bumpPatch },
            { name: `v${bumpMinor} — minor (기능 추가)`, value: bumpMinor },
            { name: `v${bumpMajor} — major (큰 변경)`, value: bumpMajor },
            { name: `v${config.version} — 유지`, value: config.version },
          ],
        })

        if (newVersion !== config.version) {
          config.version = newVersion
          const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
          yamlData.version = newVersion
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → relay.yaml에 version: ${newVersion} 저장됨\n`)
        }
      }

      // Validate structure (콘텐츠는 .relay/ 안에 있음)
      const hasDirs = VALID_DIRS.some((d) => {
        const dirPath = path.join(relayDir, d)
        if (!fs.existsSync(dirPath)) return false
        return fs.readdirSync(dirPath).filter((f) => !f.startsWith('.')).length > 0
      })
      if (!hasDirs) {
        reportCliError('publish', 'EMPTY_PACKAGE', 'no content dirs found')
        console.error(JSON.stringify({
          error: 'EMPTY_PACKAGE',
          message: '.relay/ 안에 skills/, agents/, rules/, commands/ 중 하나 이상에 파일이 있어야 합니다.',
          fix: '.relay/ 안에 skills/, agents/, rules/, commands/ 중 하나에 파일을 추가하세요.',
        }))
        process.exit(1)
      }

      // Get token (checked before tarball creation)
      const token = opts.token ?? process.env.RELAY_TOKEN ?? await getValidToken()
      if (!token) {
        reportCliError('publish', 'NO_TOKEN', 'auth required')
        console.error(JSON.stringify({
          error: 'NO_TOKEN',
          message: '인증이 필요합니다. `relay login`을 먼저 실행하세요.',
          fix: 'relay login 실행 후 재시도하세요.',
        }))
        process.exit(1)
      }

      // Fetch user's Orgs and select publish target
      let selectedOrgId: string | undefined
      let selectedOrgSlug: string | undefined
      try {
        const { fetchMyOrgs } = await import('./orgs.js')
        const orgs = await fetchMyOrgs(token)

        // Determine explicit org slug: --org > --space (legacy) > relay.yaml org_slug
        const explicitOrgSlug = opts.org ?? opts.space ?? config.org_slug

        // --org / --space / relay.yaml org_slug: resolve Org by slug
        if (explicitOrgSlug) {
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
                message: `Organization '${explicitOrgSlug}'를 찾을 수 없습니다.`,
                fix: `사용 가능한 Org: ${orgs.map((o) => o.slug).join(', ')}`,
                options: orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` })),
              }))
            } else {
              console.error(`Organization '${explicitOrgSlug}'를 찾을 수 없습니다.`)
            }
            reportCliError('publish', 'INVALID_ORG', `org:${explicitOrgSlug}`)
            process.exit(1)
          }
        } else if (isTTY) {
          if (orgs.length === 0) {
            // No orgs — publish without org_id
            console.error('\x1b[33m⚠ 소속 Organization이 없습니다. 개인 계정으로 배포합니다.\x1b[0m\n')
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
              message: '어떤 Organization에 배포할까요?',
              choices: orgChoices.map((c) => ({ name: c.name, value: c.value })),
            })
            const chosen = orgChoices.find((c) => c.value === chosenId)
            selectedOrgId = chosenId
            selectedOrgSlug = chosen?.slug
            const chosenLabel = chosen?.name ?? chosenId
            console.error(`  → Organization: ${chosenLabel}\n`)
          }
        } else if (orgs.length > 1 && json) {
          // --json 모드 + 여러 Org: 에이전트가 선택할 수 있도록 에러 반환
          reportCliError('publish', 'MISSING_ORG', 'multiple orgs, none selected')
          console.error(JSON.stringify({
            error: 'MISSING_ORG',
            message: '배포할 Organization을 선택하세요.',
            fix: `relay publish --org <slug> --json`,
            options: orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` })),
          }))
          process.exit(1)
        } else if (orgs.length > 0) {
          selectedOrgId = orgs[0].id
          selectedOrgSlug = orgs[0].slug
        }
      } catch {
        // Org 조회 실패 시 무시하고 계속 진행
      }

      // Visibility default
      const defaultVisibility: 'public' | 'private' = 'public'

      // Visibility validation: must be explicitly set
      // internal은 org가 선택된 경우에만 옵션으로 표시
      const hasOrg = !!selectedOrgId
      if (!config.visibility) {
        if (isTTY) {
          const { select: promptSelect } = await import('@inquirer/prompts')
          console.error(`\n\x1b[33m⚠ relay.yaml에 visibility가 설정되지 않았습니다.\x1b[0m  (기본값: ${defaultVisibility === 'public' ? '공개' : '비공개'})`)

          const visChoices: { name: string; value: 'public' | 'private' | 'internal' }[] = [
            {
              name: `공개 — 누구나 설치${defaultVisibility === 'public' ? '  ✓ 추천' : ''}`,
              value: 'public',
            },
            {
              name: '링크 공유 — 접근 링크가 있는 사람만 설치',
              value: 'private',
            },
          ]
          if (hasOrg) {
            visChoices.push({
              name: '비공개 — Org 멤버만 접근',
              value: 'internal',
            })
          }

          config.visibility = await promptSelect<'public' | 'private' | 'internal'>({
            message: '공개 범위를 선택하세요:',
            choices: visChoices,
            default: defaultVisibility,
          })
          // Save back to relay.yaml
          const yamlData = yaml.load(yamlContent) as Record<string, unknown>
          yamlData.visibility = config.visibility
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → relay.yaml에 visibility: ${config.visibility} 저장됨\n`)
        } else {
          reportCliError('publish', 'MISSING_VISIBILITY', 'visibility not set in relay.yaml')
          const visOptions: { value: string; label: string }[] = [
            { value: 'public', label: '공개 — 누구나 설치' },
            { value: 'private', label: '링크 공유 — 접근 링크가 있는 사람만 설치' },
          ]
          if (hasOrg) {
            visOptions.push({ value: 'internal', label: '비공개 — Org 멤버만 접근' })
          }
          console.error(JSON.stringify({
            error: 'MISSING_VISIBILITY',
            message: 'relay.yaml에 visibility를 설정해주세요.',
            options: visOptions,
            fix: 'relay.yaml의 visibility 필드를 위 옵션 중 하나로 설정하세요.',
          }))
          process.exit(1)
        }
      }

      // Confirm visibility before publish (재배포 시 변경 기회 제공)
      // Skip when a bump flag is present and visibility is already set in relay.yaml
      if (isTTY && !hasBumpFlag) {
        const { select: promptConfirmVis } = await import('@inquirer/prompts')
        const visLabelMap: Record<string, string> = {
          public: '공개',
          private: '링크공유',
          internal: '비공개',
        }
        const currentVisLabel = visLabelMap[config.visibility ?? 'public'] ?? config.visibility

        const confirmVisChoices: { name: string; value: 'public' | 'private' | 'internal' }[] = [
            {
              name: `공개 — 누구나 설치${defaultVisibility === 'public' ? '  ✓ 추천' : ''}`,
              value: 'public',
            },
            {
              name: '링크공유 — 접근 링크가 있는 사람만 설치',
              value: 'private',
            },
          ]
        if (hasOrg) {
          confirmVisChoices.push({
            name: '비공개 — Org 멤버만 접근',
            value: 'internal',
          })
        }

        const newVisibility = await promptConfirmVis<'public' | 'private' | 'internal'>({
          message: `공개 범위: ${currentVisLabel} — 유지하거나 변경하세요`,
          choices: confirmVisChoices,
          default: config.visibility ?? defaultVisibility,
        })

        if (newVisibility !== config.visibility) {
          config.visibility = newVisibility
          const yamlData = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
          yamlData.visibility = config.visibility
          fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')
          console.error(`  → relay.yaml에 visibility: ${config.visibility} 저장됨 (${visLabelMap[config.visibility]})\n`)
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
        agent_details: detectedAgents,
        skill_details: detectedSkills,
        ...(selectedOrgId ? { org_id: selectedOrgId } : {}),
        ...(selectedOrgSlug ? { org_slug: selectedOrgSlug } : {}),
      }

      if (!json) {
        console.error(`패키지 생성 중... (${config.name} v${config.version})`)
      }

      // GUIDE.html deprecation warning
      if (fs.existsSync(path.join(relayDir, 'GUIDE.html'))) {
        console.error('\x1b[33m⚠ GUIDE.html은 더 이상 지원되지 않습니다. 상세페이지가 가이드 역할을 합니다.\x1b[0m')
        console.error('  long_description을 활용하거나 relayax.com에서 에이전트 정보를 편집하세요.\n')
      }

      // Generate guide.md (consumer install guide)
      const { generateGuide } = await import('../lib/guide.js')
      const guideContent = generateGuide(
        config,
        detectedCommands,
        config.requires,
      )
      fs.writeFileSync(path.join(relayDir, 'guide.md'), guideContent)

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

      // Generate platform manifests (after preamble/command, before git commit)
      const manifestYaml: ManifestRelayYaml = {
        name: config.name,
        slug: config.slug,
        description: config.description,
        version: config.version,
        source: config.source,
        org_slug: config.org_slug ?? selectedOrgSlug,
        platforms: config.platforms,
      }
      const manifestFiles = generateManifests(manifestYaml, relayDir)
      for (const mf of manifestFiles) {
        const mfPath = path.join(relayDir, mf.relativePath)
        fs.mkdirSync(path.dirname(mfPath), { recursive: true })
        fs.writeFileSync(mfPath, mf.content)
      }
      const generatedPlatforms = [...new Set(manifestFiles.map((f) => {
        if (f.relativePath.startsWith('.claude-plugin/') || f.relativePath === 'marketplace.json') return 'claude-code'
        if (f.relativePath.startsWith('.codex-plugin/')) return 'codex'
        if (f.relativePath.startsWith('.agent/')) return 'antigravity'
        return 'unknown'
      }))]

      let tarPath: string | null = null
      try {
        tarPath = await createTarball(relayDir)

        if (!json) {
          console.error(`업로드 중...`)
        }

        const result = await publishToApi(token, tarPath, metadata)

        // Git push: commit and push to git server (required)
        const gitUrl = (result as unknown as Record<string, unknown>).git_url as string | undefined
        if (gitUrl) {
          if (!json) {
            console.error('git 저장소에 푸시 중...')
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
              console.log(JSON.stringify({ error: 'GIT_PUSH_FAILED', message: `git push 실패: ${gpMsg}` }))
            } else {
              console.error(`\x1b[31m✖ git push 실패: ${gpMsg}\x1b[0m`)
              console.error('\x1b[33m  재시도하려면 relay publish를 다시 실행하세요.\x1b[0m')
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
          const jsonResult = { ...(result as unknown as Record<string, unknown>) }
          jsonResult.platforms = generatedPlatforms
          console.log(JSON.stringify(jsonResult))
        } else {
          console.log(`\n\x1b[32m✓ ${config.name} 배포 완료\x1b[0m  v${result.version}`)
          console.log(`  슬러그: \x1b[36m${result.slug}\x1b[0m`)
          console.log(`  URL:    \x1b[36m${result.url}\x1b[0m`)

          // Build share block
          {
            const detailSlug = result.slug.startsWith('@') ? result.slug.slice(1) : result.slug
            const accessCode = result.access_code ?? null
            // const gitUrl = (result as unknown as Record<string, unknown>).git_url as string | undefined // plugin disabled

            // npx turnkey install command (works everywhere, no pre-install needed)
            const visibility = config.visibility ?? 'public'
            let npxInstallCmd: string
            if (visibility === 'internal' && accessCode) {
              npxInstallCmd = `npx relayax-cli install ${result.slug} --join-code ${accessCode}`
            } else if (visibility === 'private' && accessCode) {
              npxInstallCmd = `npx relayax-cli install ${result.slug} --code ${accessCode}`
            } else {
              npxInstallCmd = `npx relayax-cli install ${result.slug}`
            }

            // ── 설치 방법 (터미널 출력) ──
            console.log(`\n  \x1b[1m설치 방법\x1b[0m  \x1b[90m(Claude Code, Cursor, Codex 등 모든 에이전트)\x1b[0m`)
            console.log(`  ┌─`)
            console.log(`  │ ${npxInstallCmd}`)
            console.log(`  └─`)
            console.log(`\n  \x1b[90m소개:\x1b[0m https://relayax.com/@${detailSlug}`)

            // ── 공유 텍스트 (코드블록, 그대로 복붙) ──
            if (isTTY) {
              const shareBlock = [
                `[${config.name}] 설치하기`,
                ``,
                npxInstallCmd,
                ``,
                `소개: https://relayax.com/@${detailSlug}`,
              ]

              const maxLen = Math.max(...shareBlock.map((l) => l.length))
              const border = '─'.repeat(maxLen + 2)
              console.log(`\n  \x1b[90m┌${border}┐\x1b[0m`)
              for (const line of shareBlock) {
                const pad = ' '.repeat(maxLen - line.length)
                console.log(`  \x1b[90m│\x1b[0m ${line}${pad} \x1b[90m│\x1b[0m`)
              }
              console.log(`  \x1b[90m└${border}┘\x1b[0m`)
              console.log(`  \x1b[90m↑ 팀에 공유하세요\x1b[0m`)
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportCliError('publish', 'PUBLISH_FAILED', message)
        console.error(JSON.stringify({ error: 'PUBLISH_FAILED', message, fix: message }))
        process.exit(1)
      } finally {
        if (tarPath && fs.existsSync(tarPath)) {
          fs.unlinkSync(tarPath)
        }
      }
    })
}
