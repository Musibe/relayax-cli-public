import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getValidToken, API_URL, loadInstalled, loadGlobalInstalled, saveInstalled, saveGlobalInstalled } from '../lib/config.js'
import { searchAgents, fetchAgentInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'
import { makeTempDir, removeTempDir, clonePackage } from '../lib/storage.js'
import { checkGitInstalled } from '../lib/git-operations.js'
import { detectAgentCLIs, detectMountedCLIs, scanLocalItems, scanGlobalItems, scanMountedItems } from '../lib/ai-tools.js'
import { injectPreambleToAgent, generatePreambleBin } from '../lib/preamble.js'
import { uninstallAgent } from '../lib/installer.js'
import { resolveProjectPath, resolveHome } from '../lib/paths.js'
// prompts are used in MCP Prompt definitions below
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

// ─── Helpers ───

async function resolveUserInfo(token: string): Promise<{ username?: string; email?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return {}
    const body = await res.json() as { username?: string; email?: string }
    return { username: body.username, email: body.email }
  } catch {
    return {}
  }
}

function countFiles(dir: string): number {
  let count = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name))
    else count++
  }
  return count
}

function jsonText(obj: unknown) {
  return { type: 'text' as const, text: JSON.stringify(obj) }
}

// 주요 도구 응답에 CLI 업데이트 경고를 병합하는 헬퍼
// MCP 서버 프로세스는 Claude 재시작 전까지 유지되므로, 응답에 버전 정보를 포함시켜
// 에이전트가 사용자에게 재시작을 안내할 수 있도록 한다.
let _cachedCliUpdate: { latest: string } | null | undefined
async function getCliUpdateWarning(): Promise<Record<string, unknown> | null> {
  if (_cachedCliUpdate === undefined) {
    try {
      const { checkCliVersion } = await import('../lib/version-check.js')
      _cachedCliUpdate = await checkCliVersion(true)
    } catch {
      _cachedCliUpdate = null
    }
  }
  if (!_cachedCliUpdate) return null
  return {
    cli_update: {
      current: pkg.version,
      latest: _cachedCliUpdate.latest,
      message: `relay v${_cachedCliUpdate.latest}이 있습니다. npm update -g relayax-cli 후 Claude를 재시작해주세요.`,
    },
  }
}

function jsonTextWithUpdate(obj: Record<string, unknown>, update: Record<string, unknown> | null) {
  return jsonText(update ? { ...obj, ...update } : obj)
}

// MCP 서버는 Claude Desktop이 spawn하므로 cwd가 / 등 예측 불가한 경로일 수 있다.
// project_path가 없을 때 cwd 대신 홈 디렉토리를 fallback으로 사용한다.
import os from 'os'
function resolveMcpProjectPath(projectPath?: string): string {
  if (projectPath) return projectPath
  const resolved = resolveProjectPath()
  // cwd가 / 또는 비정상적이면 홈 디렉토리 사용
  if (resolved === '/' || resolved === '') return os.homedir()
  return resolved
}

// ─── Server ───

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'relay', version: pkg.version },
    { capabilities: { tools: {}, prompts: {} } },
  )

  // ═══ Tools ═══

  server.tool('relay_search', '에이전트를 검색합니다', {
    query: z.string().describe('검색 키워드'),
    tag: z.string().optional().describe('태그 필터'),
  }, async ({ query, tag }) => {
    try {
      const results = await searchAgents(query, tag)
      return { content: [jsonText({ results: results.map((r) => ({ slug: r.slug, name: r.name, description: r.description, installs: r.install_count })) })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_install', '에이전트를 설치합니다', {
    slug: z.string().describe('에이전트 slug (예: @owner/name)'),
    project_path: z.string().optional().describe('프로젝트 경로 (기본: 홈 디렉토리)'),
  }, async ({ slug: slugInput, project_path }) => {
    try {
      const projectPath = resolveMcpProjectPath(project_path)
      const token = await getValidToken()
      const parsed = await resolveSlug(slugInput)
      const fullSlug = parsed.full
      const agent = await fetchAgentInfo(fullSlug)
      if (!agent) throw new Error('에이전트 정보를 가져오지 못했습니다.')

      if ((agent.visibility ?? 'public') !== 'public' && !token) {
        return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '이 에이전트는 로그인이 필요합니다.' })], isError: true }
      }

      const tempDir = makeTempDir()
      try {
        const agentDir = path.join(projectPath, '.relay', 'agents', parsed.owner, parsed.name)

        if (!agent.git_url) {
          return { content: [jsonText({ error: 'NO_GIT_URL', message: '이 에이전트는 재publish가 필요합니다. 빌더에게 문의하세요.' })], isError: true }
        }
        checkGitInstalled()
        await clonePackage(agent.git_url, agentDir)

        // Verify clone has actual files
        const clonedEntries = fs.readdirSync(agentDir).filter((f: string) => f !== '.git')
        if (clonedEntries.length === 0) {
          fs.rmSync(agentDir, { recursive: true, force: true })
          return { content: [jsonText({ error: 'EMPTY_PACKAGE', message: '에이전트 패키지가 비어있습니다. 빌더에게 재publish를 요청하세요.' })], isError: true }
        }
        injectPreambleToAgent(agentDir, fullSlug)

        const installed = loadInstalled()
        installed[fullSlug] = { agent_id: agent.id, version: agent.version, installed_at: new Date().toISOString(), files: [agentDir] }
        saveInstalled(installed)

        await reportInstall(agent.id, fullSlug, agent.version)
        sendUsagePing(agent.id, fullSlug, agent.version)

        // relay.yaml에서 tags, requires, recommended_scope 읽기
        let agentTags: string[] = []
        let agentRequires: unknown = null
        let hasRules = false
        let recommendedScope: 'global' | 'local' | undefined
        try {
          const relayYamlPath = path.join(agentDir, 'relay.yaml')
          if (fs.existsSync(relayYamlPath)) {
            const cfg = yaml.load(fs.readFileSync(relayYamlPath, 'utf-8')) as Record<string, unknown>
            agentTags = (cfg.tags as string[]) ?? []
            agentRequires = cfg.requires ?? null
            if (cfg.recommended_scope === 'global' || cfg.recommended_scope === 'local') {
              recommendedScope = cfg.recommended_scope
            }
          }
          hasRules = fs.existsSync(path.join(agentDir, 'rules')) && fs.readdirSync(path.join(agentDir, 'rules')).length > 0
        } catch { /* non-critical */ }

        // recommended_scope가 relay.yaml에 없으면 휴리스틱으로 추론
        if (!recommendedScope) {
          const frameworkTags = ['nextjs', 'react', 'vue', 'angular', 'svelte', 'nuxt', 'remix', 'astro', 'django', 'rails', 'laravel', 'spring', 'express', 'fastapi', 'flask']
          recommendedScope = (hasRules || agentTags.some((t) => frameworkTags.includes(t.toLowerCase()))) ? 'local' : 'global'
        }

        const cliUpdate = await getCliUpdateWarning()
        return { content: [jsonTextWithUpdate({
          status: 'ok', agent: agent.name, slug: fullSlug, version: agent.version,
          description: agent.description ?? '', tags: agentTags, requires: agentRequires, has_rules: hasRules,
          recommended_scope: recommendedScope,
          files: countFiles(agentDir), install_path: agentDir,
          scope_hint: `이 에이전트의 권장 배치 범위는 "${recommendedScope}"입니다. 사용자에게 확인 후 relay deploy --scope ${recommendedScope}로 배치하세요.`,
        }, cliUpdate)] }
      } finally {
        removeTempDir(tempDir)
      }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_uninstall', '에이전트를 제거합니다', {
    slug: z.string().describe('에이전트 slug'),
  }, async ({ slug: slugInput }) => {
    try {
      const local = loadInstalled()
      const global = loadGlobalInstalled()
      const entry = local[slugInput] ?? global[slugInput]
      if (!entry) {
        return { content: [jsonText({ error: 'NOT_INSTALLED', message: `'${slugInput}'는 설치되어 있지 않습니다.` })], isError: true }
      }
      let removed = 0
      if (local[slugInput]) {
        removed += uninstallAgent(local[slugInput].files).length
        delete local[slugInput]
        saveInstalled(local)
      }
      if (global[slugInput]) {
        removed += uninstallAgent(global[slugInput].files).length
        delete global[slugInput]
        saveGlobalInstalled(global)
      }
      return { content: [jsonText({ status: 'ok', removed_files: removed })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_list', '설치된 에이전트 목록을 조회합니다', {}, async () => {
    const local = loadInstalled()
    const global = loadGlobalInstalled()
    const agents = [
      ...Object.entries(local).map(([slug, e]) => ({ slug, version: e.version, installed_at: e.installed_at, scope: 'local' })),
      ...Object.entries(global).map(([slug, e]) => ({ slug, version: e.version, installed_at: e.installed_at, scope: 'global' })),
    ]
    return { content: [jsonText({ agents })] }
  })

  server.tool('relay_status', '현재 relay 환경 상태를 표시합니다', {
    project_path: z.string().optional().describe('프로젝트 경로'),
  }, async ({ project_path }) => {
    const projectPath = resolveMcpProjectPath(project_path)
    const token = await getValidToken()
    let username: string | undefined
    let email: string | undefined
    if (token) {
      const info = await resolveUserInfo(token)
      username = info.username
      email = info.email
    }

    const detected = detectAgentCLIs(projectPath)
    const mounted = detectMountedCLIs()
    const relayYaml = path.join(projectPath, '.relay', 'relay.yaml')
    let project = null
    if (fs.existsSync(relayYaml)) {
      try {
        const cfg = yaml.load(fs.readFileSync(relayYaml, 'utf-8')) as Record<string, unknown>
        project = { is_agent: true, name: cfg.name, slug: cfg.slug, version: cfg.version }
      } catch { /* skip */ }
    }

    // 버전 확인
    const { checkCliVersion } = await import('../lib/version-check.js')
    const cliUpdate = await checkCliVersion(true)

    return { content: [jsonText({
      cli: { version: pkg.version, update_available: cliUpdate ? cliUpdate.latest : null },
      login: { authenticated: !!token, username, email },
      agent_clis: detected.map((t) => t.name),
      mounted_paths: mounted.map((m) => m.basePath),
      project,
    })] }
  })

  server.tool('relay_check_update', 'CLI 및 에이전트 업데이트를 확인합니다. slug 지정 시 해당 에이전트만 체크하며 사용 현황도 기록합니다 (preamble 대체).', {
    slug: z.string().optional().describe('특정 에이전트 slug (예: @owner/name). 생략하면 전체 체크'),
  }, async ({ slug: slugInput }) => {
    const { checkCliVersion, checkAgentVersion, checkAllAgents } = await import('../lib/version-check.js')

    // slug가 지정되면 해당 에이전트의 usage ping도 함께 전송
    if (slugInput) {
      const local = loadInstalled()
      const global = loadGlobalInstalled()
      const entry = local[slugInput] ?? global[slugInput]
      const agentId = entry?.agent_id ?? null
      const version = entry?.version
      sendUsagePing(agentId, slugInput, version)
    }

    const cliUpdate = await checkCliVersion(true)
    const updates = []
    if (cliUpdate) updates.push({ type: 'cli', current: cliUpdate.current, latest: cliUpdate.latest })

    if (slugInput) {
      const agentUpdate = await checkAgentVersion(slugInput, true)
      if (agentUpdate) updates.push({ type: 'agent', slug: agentUpdate.slug, current: agentUpdate.current, latest: agentUpdate.latest })
    } else {
      const agentUpdates = await checkAllAgents(true)
      for (const u of agentUpdates) updates.push({ type: 'agent', slug: u.slug, current: u.current, latest: u.latest })
    }

    if (updates.length === 0) {
      return { content: [jsonText({ status: 'up_to_date', message: '모두 최신 버전입니다.', cli_version: pkg.version })] }
    }
    return { content: [jsonText({ status: 'updates_available', updates, message: 'CLI를 업데이트하려면: npm update -g relayax-cli' })] }
  })

  server.tool('relay_scan', '배포 가능한 스킬/에이전트/커맨드를 스캔합니다', {
    project_path: z.string().optional().describe('프로젝트 경로'),
  }, async ({ project_path }) => {
    const projectPath = resolveMcpProjectPath(project_path)
    const homeDir = resolveHome()

    interface SourceEntry { path: string; location: string; name: string; items: { name: string; type: string }[] }
    const sources: SourceEntry[] = []

    // 로컬
    for (const tool of detectAgentCLIs(projectPath)) {
      const items = scanLocalItems(projectPath, tool)
      if (items.length > 0) sources.push({ path: tool.skillsDir, location: 'local', name: tool.name, items: items.map((i) => ({ name: i.name, type: i.type })) })
    }
    // 글로벌
    const { detectGlobalCLIs } = await import('../lib/ai-tools.js')
    for (const tool of detectGlobalCLIs(homeDir)) {
      const items = scanGlobalItems(tool, homeDir)
      if (items.length > 0) sources.push({ path: `~/${tool.skillsDir}`, location: 'global', name: `${tool.name} (global)`, items: items.map((i) => ({ name: i.name, type: i.type })) })
    }
    // 마운트 (Cowork)
    for (const { tool, basePath } of detectMountedCLIs()) {
      const items = scanMountedItems(basePath, tool)
      if (items.length > 0) sources.push({ path: `${basePath}/${tool.skillsDir}`, location: 'mounted', name: `${tool.name} (mounted)`, items: items.map((i) => ({ name: i.name, type: i.type })) })
    }

    return { content: [jsonText({ sources })] }
  })

  server.tool('relay_package', '소스 디렉토리에서 .relay/로 콘텐츠를 패키징합니다. mode: init(최초 소스 탐색), sync(변경 반영), migrate(source→contents 마이그레이션)', {
    mode: z.enum(['init', 'sync', 'migrate']).describe('패키징 모드'),
    project_path: z.string().optional().describe('프로젝트 경로'),
  }, async ({ mode, project_path }) => {
    try {
      const projectPath = resolveMcpProjectPath(project_path)
      const homeDir = resolveHome()
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')

      if (mode === 'init') {
        // 최초 패키징: 소스 탐색
        const { detectGlobalCLIs } = await import('../lib/ai-tools.js')
        const localTools = detectAgentCLIs(projectPath)
        const globalTools = detectGlobalCLIs(homeDir)

        interface SourceEntry { path: string; location: string; name: string; items: { name: string; type: string; relativePath: string }[] }
        const sources: SourceEntry[] = []

        for (const tool of localTools) {
          const items = scanLocalItems(projectPath, tool)
          if (items.length > 0) sources.push({ path: tool.skillsDir, location: 'local', name: tool.name, items: items.map((i) => ({ name: i.name, type: i.type, relativePath: i.relativePath })) })
        }
        for (const tool of globalTools) {
          const items = scanGlobalItems(tool, homeDir)
          if (items.length > 0) sources.push({ path: `~/${tool.skillsDir}`, location: 'global', name: `${tool.name} (global)`, items: items.map((i) => ({ name: i.name, type: i.type, relativePath: i.relativePath })) })
        }
        for (const { tool, basePath } of detectMountedCLIs()) {
          const items = scanMountedItems(basePath, tool)
          if (items.length > 0) sources.push({ path: `${basePath}/${tool.skillsDir}`, location: 'mounted', name: `${tool.name} (mounted)`, items: items.map((i) => ({ name: i.name, type: i.type, relativePath: i.relativePath })) })
        }

        // 기존 글로벌 에이전트 패키지 스캔
        const globalAgentsDir = path.join(homeDir, '.relay', 'agents')
        const existingAgents: { slug: string; name: string; version: string; path: string }[] = []
        if (fs.existsSync(globalAgentsDir)) {
          for (const entry of fs.readdirSync(globalAgentsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue
            const agentYaml = path.join(globalAgentsDir, entry.name, 'relay.yaml')
            if (fs.existsSync(agentYaml)) {
              try {
                const cfg = yaml.load(fs.readFileSync(agentYaml, 'utf-8')) as Record<string, unknown>
                existingAgents.push({ slug: (cfg.slug as string) ?? entry.name, name: (cfg.name as string) ?? entry.name, version: (cfg.version as string) ?? '0.0.0', path: `~/.relay/agents/${entry.name}` })
              } catch { /* skip */ }
            }
          }
        }

        return { content: [jsonText({ status: 'init_required', sources, existing_agents: existingAgents })] }
      }

      // sync / migrate는 relay.yaml이 필요
      if (!fs.existsSync(relayYamlPath)) {
        return { content: [jsonText({ error: 'NOT_INITIALIZED', message: '.relay/relay.yaml이 없습니다. mode: init으로 먼저 실행하세요.' })], isError: true }
      }

      if (mode === 'migrate') {
        const yamlMigrate = fs.readFileSync(relayYamlPath, 'utf-8')
        const cfgMigrate = yaml.load(yamlMigrate) as Record<string, unknown>
        if (cfgMigrate.contents) {
          return { content: [jsonText({ status: 'already_migrated', message: '이미 contents 형식입니다.' })] }
        }
        const legacySource = cfgMigrate.source as string | undefined
        if (!legacySource) {
          return { content: [jsonText({ status: 'no_source', message: 'source 필드가 없습니다.' })], isError: true }
        }

        const localTools = detectAgentCLIs(projectPath)
        const tool = localTools.find((t) => t.skillsDir === legacySource)
        const migratedContents: { name: string; type: string; from: string }[] = []
        if (tool) {
          const items = scanLocalItems(projectPath, tool)
          for (const item of items) {
            migratedContents.push({ name: item.name, type: item.type, from: `${legacySource}/${item.relativePath}` })
          }
        }
        delete cfgMigrate.source
        cfgMigrate.contents = migratedContents
        fs.writeFileSync(relayYamlPath, yaml.dump(cfgMigrate, { lineWidth: 120 }), 'utf-8')
        return { content: [jsonText({ status: 'migrated', contents: migratedContents })] }
      }

      // mode === 'sync'
      const { computeContentsDiff, syncContentsToRelay } = await import('../commands/package.js')
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const config = yaml.load(yamlContent) as Record<string, unknown>
      const contents = (config.contents as unknown[]) ?? []

      if (contents.length === 0) {
        return { content: [jsonText({ status: 'no_contents', message: 'relay.yaml에 contents가 없습니다.' })], isError: true }
      }

      const { diff: contentsDiff, newItems } = computeContentsDiff(contents as any, relayDir, projectPath)
      const hasChanges = contentsDiff.some((d: any) => d.status === 'modified')

      if (hasChanges) {
        syncContentsToRelay(contents as any, contentsDiff as any, relayDir, projectPath)
      }

      const summary = {
        modified: contentsDiff.filter((d: any) => d.status === 'modified').length,
        unchanged: contentsDiff.filter((d: any) => d.status === 'unchanged').length,
        source_missing: contentsDiff.filter((d: any) => d.status === 'source_missing').length,
        new_available: newItems.length,
      }

      return { content: [jsonText({ diff: contentsDiff, new_items: newItems, synced: hasChanges, summary })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_org_list', '소속 Organization 목록을 조회합니다', {}, async () => {
    try {
      const token = await getValidToken()
      if (!token) {
        return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' })], isError: true }
      }
      const { fetchMyOrgs } = await import('../commands/orgs.js')
      const orgs = await fetchMyOrgs(token)
      return { content: [jsonText({ orgs: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role: o.role })) })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_org_create', '새 Organization을 생성합니다', {
    name: z.string().describe('Organization 이름'),
    slug: z.string().optional().describe('URL slug (미지정 시 이름에서 자동 생성)'),
  }, async ({ name, slug: slugInput }) => {
    try {
      const token = await getValidToken()
      if (!token) {
        return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' })], isError: true }
      }
      const slug = slugInput ?? name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50)

      const res = await fetch(`${API_URL}/api/orgs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, slug }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: `${res.status}` })) as { message?: string }
        throw new Error(body.message ?? `Organization 생성 실패 (${res.status})`)
      }
      const org = await res.json() as { slug: string; name: string }
      return { content: [jsonText({ status: 'created', org })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_publish', '에이전트를 마켓플레이스에 배포합니다 (.relay/ 디렉토리를 tar로 패키징하여 업로드)', {
    project_path: z.string().optional().describe('프로젝트 경로 (.relay/relay.yaml이 있는 디렉토리)'),
  }, async ({ project_path }) => {
    try {
      const projectPath = resolveMcpProjectPath(project_path)
      const relayDir = path.join(projectPath, '.relay')
      const relayYaml = path.join(relayDir, 'relay.yaml')

      if (!fs.existsSync(relayYaml)) {
        return { content: [jsonText({ error: 'NOT_INITIALIZED', message: '.relay/relay.yaml이 없습니다.' })], isError: true }
      }

      const token = await getValidToken()
      if (!token) {
        return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '배포하려면 로그인이 필요합니다.' })], isError: true }
      }

      const cfg = yaml.load(fs.readFileSync(relayYaml, 'utf-8')) as Record<string, unknown>
      const { createTarball, publishToApi } = await import('../commands/publish.js')

      // Generate bin/relay-preamble.sh (CLI publish와 동일하게)
      generatePreambleBin(relayDir, cfg.slug as string, API_URL)

      const tarPath = await createTarball(relayDir)
      try {
        const metadata = {
          slug: cfg.slug as string,
          name: cfg.name as string,
          description: (cfg.description as string) ?? '',
          tags: (cfg.tags as string[]) ?? [],
          commands: [],
          components: { skills: 0, agents: 0, rules: 0, commands: 0 },
          version: cfg.version as string,
          visibility: (cfg.visibility as 'public' | 'private' | 'internal') ?? 'public',
          cli_version: pkg.version,
        }

        const result = await publishToApi(token, tarPath, metadata)
        const cliUpdate = await getCliUpdateWarning()
        return { content: [jsonTextWithUpdate(result as unknown as Record<string, unknown>, cliUpdate)] }
      } finally {
        fs.unlinkSync(tarPath)
      }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ grant / access / join ═══

  server.tool('relay_grant_create', '에이전트 또는 Organization의 접근 코드를 생성합니다', {
    agent_slug: z.string().optional().describe('에이전트 slug (agent 접근 코드 생성 시)'),
    org_slug: z.string().optional().describe('Organization slug (org 접근 코드 생성 시)'),
    max_uses: z.number().optional().describe('최대 사용 횟수'),
    expires_at: z.string().optional().describe('만료일 (ISO 8601)'),
  }, async ({ agent_slug, org_slug, max_uses, expires_at }) => {
    try {
      if (!agent_slug && !org_slug) {
        return { content: [jsonText({ error: 'MISSING_OPTION', message: 'agent_slug 또는 org_slug가 필요합니다.' })], isError: true }
      }
      const token = await getValidToken()
      if (!token) return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' })], isError: true }

      let agentId: string | undefined
      let orgId: string | undefined

      if (agent_slug) {
        const res = await fetch(`${API_URL}/api/agents/${agent_slug}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('에이전트를 찾을 수 없습니다.')
        agentId = ((await res.json()) as { id: string }).id
      }
      if (org_slug) {
        const res = await fetch(`${API_URL}/api/orgs/${org_slug}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Organization을 찾을 수 없습니다.')
        orgId = ((await res.json()) as { id: string }).id
      }

      const { createAccessCode } = await import('../commands/grant.js')
      const result = await createAccessCode({
        type: agentId ? 'agent' : 'org',
        agent_id: agentId,
        org_id: orgId,
        max_uses,
        expires_at,
      })
      return { content: [jsonText({ status: 'created', ...result })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_grant_use', '접근 코드를 사용하여 org 가입 또는 에이전트 접근 권한을 획득합니다', {
    code: z.string().describe('접근 코드'),
  }, async ({ code }) => {
    try {
      const { useAccessCode } = await import('../commands/grant.js')
      const result = await useAccessCode(code)
      return { content: [jsonText({ ...result, status: 'ok' })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_access', '접근 코드로 비공개 에이전트 접근 권한을 획득합니다 (설치는 별도로 relay_install 호출 필요)', {
    slug: z.string().describe('에이전트 slug'),
    code: z.string().describe('접근 코드'),
  }, async ({ slug: slugInput, code }) => {
    try {
      const token = await getValidToken()
      if (!token) return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' })], isError: true }

      const res = await fetch(`${API_URL}/api/agents/${slugInput}/claim-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message ?? `접근 권한 획득 실패 (${res.status})`)
      }
      const result = await res.json()
      return { content: [jsonText({ status: 'ok', ...(result as Record<string, unknown>) })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_join', '초대 코드로 Organization에 가입합니다', {
    code: z.string().describe('초대 코드 (UUID)'),
  }, async ({ code }) => {
    try {
      const { useAccessCode } = await import('../commands/grant.js')
      const result = await useAccessCode(code)
      return { content: [jsonText({ ...result, status: 'ok' })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ relay_deploy_record — 배치 파일 기록 ═══

  server.tool('relay_deploy_record', '에이전트 파일 배치 정보를 installed.json에 기록합니다', {
    slug: z.string().describe('에이전트 slug'),
    scope: z.enum(['global', 'local']).describe('배치 범위 (global 또는 local)'),
    files: z.array(z.string()).optional().describe('배치된 파일 경로 목록'),
  }, async ({ slug: slugInput, scope, files }) => {
    try {
      const { isScopedSlug, parseSlug } = await import('../lib/slug.js')
      const localRegistry = loadInstalled()
      const globalRegistry = loadGlobalInstalled()

      let slug: string
      if (isScopedSlug(slugInput)) {
        slug = slugInput
      } else {
        const allKeys = [...Object.keys(localRegistry), ...Object.keys(globalRegistry)]
        const match = allKeys.find((key) => {
          const parsed = parseSlug(key)
          return parsed && parsed.name === slugInput
        })
        slug = match ?? slugInput
      }

      const entry = localRegistry[slug] ?? globalRegistry[slug]
      if (!entry) {
        return { content: [jsonText({ error: 'NOT_INSTALLED', message: `'${slugInput}'는 설치되어 있지 않습니다.` })], isError: true }
      }

      entry.deploy_scope = scope
      entry.deployed_files = files ?? []

      if (scope === 'global') {
        globalRegistry[slug] = entry
        saveGlobalInstalled(globalRegistry)
        if (localRegistry[slug]) { localRegistry[slug] = entry; saveInstalled(localRegistry) }
      } else {
        localRegistry[slug] = entry
        saveInstalled(localRegistry)
      }

      return { content: [jsonText({ status: 'ok', slug, deploy_scope: scope, deployed_files: (files ?? []).length })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ relay_login — device code 로그인 ═══

  server.tool('relay_login', 'Device Code 방식으로 로그인합니다. URL과 코드를 사용자에게 보여주고, 승인을 기다립니다.', {}, async () => {
    try {
      // 이미 로그인되어 있는지 확인
      const existingToken = await getValidToken()
      if (existingToken) {
        const { username, email } = await resolveUserInfo(existingToken)
        return { content: [jsonText({ status: 'already_authenticated', username, email })] }
      }

      // Device code 발급
      const res = await fetch(`${API_URL}/api/auth/device/request`, { method: 'POST' })
      if (!res.ok) throw new Error('Device code 발급에 실패했습니다')

      const { device_code, user_code, verification_url, expires_in } = await res.json() as {
        device_code: string; user_code: string; verification_url: string; expires_in: number
      }

      // 브라우저 열기 시도
      try {
        const { execSync } = await import('child_process')
        if (process.platform === 'darwin') execSync(`open "${verification_url}?user_code=${user_code}"`, { stdio: 'ignore' })
        else if (process.platform === 'win32') execSync(`start "" "${verification_url}?user_code=${user_code}"`, { stdio: 'ignore' })
        else execSync(`xdg-open "${verification_url}?user_code=${user_code}"`, { stdio: 'ignore' })
      } catch { /* 브라우저 열기 실패 — 사용자가 직접 열어야 함 */ }

      // Polling (최대 expires_in 초, 5초 간격)
      const deadline = Date.now() + expires_in * 1000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000))
        const pollRes = await fetch(`${API_URL}/api/auth/device/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code }),
        })
        if (!pollRes.ok) continue
        const data = await pollRes.json() as { status: string; token?: string; refresh_token?: string; expires_at?: string }
        if (data.status === 'approved' && data.token) {
          const { saveTokenData, ensureGlobalRelayDir } = await import('../lib/config.js')
          ensureGlobalRelayDir()
          saveTokenData({
            access_token: data.token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at ? Number(data.expires_at) : undefined,
          })
          const { username, email } = await resolveUserInfo(data.token)
          return { content: [jsonText({ status: 'ok', message: '로그인 완료', username, email })] }
        }
      }

      return { content: [jsonText({ status: 'timeout', verification_url, user_code, message: `브라우저에서 ${verification_url} 을 열고 코드 ${user_code} 를 입력해주세요.` })], isError: true }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ relay_guide — 에이전트 설치 가이드 조회 ═══

  server.tool('relay_guide', '에이전트 설치 가이드를 조회합니다. URL을 fetch할 수 없는 샌드박스 환경에서 사용하세요.', {
    slug: z.string().describe('에이전트 slug (예: @owner/name)'),
    code: z.string().optional().describe('접근 코드 (비공개 에이전트용)'),
  }, async ({ slug: slugInput, code }) => {
    try {
      const parsed = await resolveSlug(slugInput)
      let url = `${API_URL}/api/registry/${parsed.owner}/${parsed.name}/guide.md`
      if (code) url += `?code=${encodeURIComponent(code)}`
      const res = await fetch(url)
      if (!res.ok) {
        if (res.status === 404) throw new Error('에이전트를 찾을 수 없습니다.')
        throw new Error(`가이드를 가져올 수 없습니다 (${res.status})`)
      }
      const guide = await res.text()
      return { content: [{ type: 'text' as const, text: guide }] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ relay_init — slash command 설치 ═══

  server.tool('relay_init', 'relay slash command를 설치합니다 (/relay-install, /relay-publish 등)', {}, async () => {
    try {
      const { installGlobalUserCommands, hasGlobalUserCommands } = await import('../commands/init.js')
      if (hasGlobalUserCommands()) {
        installGlobalUserCommands() // 업데이트
        return { content: [jsonText({ status: 'updated', message: 'relay slash command가 업데이트되었습니다.' })] }
      }
      installGlobalUserCommands()
      return { content: [jsonText({ status: 'installed', message: 'relay slash command가 설치되었습니다. /relay-install, /relay-publish 등을 사용할 수 있습니다.' })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  // ═══ Detail Images — 상세페이지 이미지 관리 ═══

  server.tool('relay_detail_upload', '에이전트 상세페이지 이미지를 업로드합니다. 폴더 내 이미지를 파일명 순으로 정렬하여 업로드합니다 (기존 이미지 전체 교체).', {
    slug: z.string().describe('에이전트 slug'),
    path: z.string().describe('이미지가 있는 폴더 경로 (PNG/GIF/JPEG/WebP)'),
  }, async ({ slug, path: dirPath }) => {
    try {
      const token = getValidToken()
      if (!token) return { content: [jsonText({ error: '로그인이 필요합니다. relay login을 먼저 실행하세요.' })], isError: true }

      const absPath = path.resolve(dirPath)
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        return { content: [jsonText({ error: `폴더를 찾을 수 없습니다: ${absPath}` })], isError: true }
      }

      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
      const files = fs.readdirSync(absPath)
        .filter((f) => imageExts.includes(path.extname(f).toLowerCase()))
        .sort()

      if (files.length === 0) {
        return { content: [jsonText({ error: '폴더에 이미지 파일이 없습니다 (PNG/GIF/JPEG/WebP)' })], isError: true }
      }

      const formData = new FormData()
      for (const file of files) {
        const filePath = path.join(absPath, file)
        const buffer = fs.readFileSync(filePath)
        const ext = path.extname(file).toLowerCase()
        const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
        const blob = new Blob([buffer], { type: mimeMap[ext] || 'image/png' })
        formData.append('files', blob, file)
      }

      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData as unknown as BodyInit,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { content: [jsonText({ error: (body as { message?: string }).message || `업로드 실패 (${res.status})` })], isError: true }
      }

      const result = await res.json() as { detail_images: string[]; count: number }
      const update = await getCliUpdateWarning()
      return { content: [jsonTextWithUpdate({ status: 'uploaded', count: result.count, images: result.detail_images }, update)] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_detail_list', '에이전트 상세페이지 이미지 목록을 조회합니다', {
    slug: z.string().describe('에이전트 slug'),
  }, async ({ slug }) => {
    try {
      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`)
      if (!res.ok) {
        return { content: [jsonText({ error: `조회 실패 (${res.status})` })], isError: true }
      }
      const data = await res.json() as { detail_images: string[] }
      return { content: [jsonText({ detail_images: data.detail_images, count: data.detail_images.length })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_detail_clear', '에이전트 상세페이지 이미지를 모두 삭제합니다', {
    slug: z.string().describe('에이전트 slug'),
  }, async ({ slug }) => {
    try {
      const token = getValidToken()
      if (!token) return { content: [jsonText({ error: '로그인이 필요합니다.' })], isError: true }

      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { content: [jsonText({ error: (body as { message?: string }).message || `삭제 실패 (${res.status})` })], isError: true }
      }

      const result = await res.json() as { deleted: number }
      return { content: [jsonText({ status: 'cleared', deleted: result.deleted })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  return server
}

// ─── Start ───

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
