import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getValidToken, API_URL, loadInstalled, loadGlobalInstalled, saveInstalled, saveGlobalInstalled } from '../lib/config.js'
import { searchAgents, fetchAgentInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'
import { downloadPackage, extractPackage, makeTempDir, removeTempDir } from '../lib/storage.js'
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

async function resolveUsername(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return undefined
    const body = await res.json() as { username?: string }
    return body.username
  } catch {
    return undefined
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
    project_path: z.string().optional().describe('프로젝트 경로 (기본: cwd)'),
  }, async ({ slug: slugInput, project_path }) => {
    try {
      const projectPath = project_path ?? resolveProjectPath()
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
        const tarPath = await downloadPackage(agent.package_url, tempDir)
        const agentDir = path.join(projectPath, '.relay', 'agents', parsed.owner, parsed.name)
        if (fs.existsSync(agentDir)) fs.rmSync(agentDir, { recursive: true, force: true })
        fs.mkdirSync(agentDir, { recursive: true })
        await extractPackage(tarPath, agentDir)
        injectPreambleToAgent(agentDir, fullSlug)

        const installed = loadInstalled()
        installed[fullSlug] = { agent_id: agent.id, version: agent.version, installed_at: new Date().toISOString(), files: [agentDir] }
        saveInstalled(installed)

        await reportInstall(agent.id, fullSlug, agent.version)
        sendUsagePing(agent.id, fullSlug, agent.version)

        return { content: [jsonText({ status: 'ok', agent: agent.name, slug: fullSlug, version: agent.version, files: countFiles(agentDir), install_path: agentDir })] }
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
    const projectPath = project_path ?? resolveProjectPath()
    const token = await getValidToken()
    let username: string | undefined
    if (token) username = await resolveUsername(token)

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
      login: { authenticated: !!token, username },
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
    const projectPath = project_path ?? resolveProjectPath()
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

  server.tool('relay_publish', '에이전트를 마켓플레이스에 배포합니다 (.relay/ 디렉토리를 tar로 패키징하여 업로드)', {
    project_path: z.string().optional().describe('프로젝트 경로 (.relay/relay.yaml이 있는 디렉토리)'),
  }, async ({ project_path }) => {
    try {
      const projectPath = project_path ?? resolveProjectPath()
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
        return { content: [jsonText(result)] }
      } finally {
        fs.unlinkSync(tarPath)
      }
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
        const username = await resolveUsername(existingToken)
        return { content: [jsonText({ status: 'already_authenticated', username })] }
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
          const username = await resolveUsername(data.token)
          return { content: [jsonText({ status: 'ok', message: '로그인 완료', username })] }
        }
      }

      return { content: [jsonText({ status: 'timeout', verification_url, user_code, message: `브라우저에서 ${verification_url} 을 열고 코드 ${user_code} 를 입력해주세요.` })], isError: true }
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

  return server
}

// ─── Start ───

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
