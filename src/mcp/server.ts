import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getValidToken, API_URL, loadInstalled, loadGlobalInstalled, saveInstalled, saveGlobalInstalled } from '../lib/config.js'
import { searchAgents, fetchAgentInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import { resolveSlug } from '../lib/slug.js'
import { downloadPackage, extractPackage, makeTempDir, removeTempDir } from '../lib/storage.js'
import { detectAgentCLIs, detectMountedCLIs, scanLocalItems, scanGlobalItems, scanMountedItems } from '../lib/ai-tools.js'
import { injectPreambleToAgent } from '../lib/preamble.js'
import { uninstallAgent } from '../lib/installer.js'
import { resolveProjectPath, resolveHome } from '../lib/paths.js'
import { INSTALL_PROMPT, PUBLISH_PROMPT } from '../prompts/index.js'
import fs from 'fs'
import path from 'path'
import os from 'os'
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

    return { content: [jsonText({ login: { authenticated: !!token, username }, agent_clis: detected.map((t) => t.name), mounted_paths: mounted.map((m) => m.basePath), project })] }
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

  server.tool('relay_publish', '에이전트를 마켓플레이스에 배포합니다', {
    project_path: z.string().optional().describe('프로젝트 경로'),
  }, async ({ project_path }) => {
    const projectPath = project_path ?? resolveProjectPath()
    const relayYaml = path.join(projectPath, '.relay', 'relay.yaml')

    if (!fs.existsSync(relayYaml)) {
      return { content: [jsonText({ error: 'NOT_INITIALIZED', message: '.relay/relay.yaml이 없습니다. relay-publish 프롬프트를 사용하여 프로젝트를 먼저 설정하세요.' })], isError: true }
    }

    const token = await getValidToken()
    if (!token) {
      return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: '배포하려면 로그인이 필요합니다.' })], isError: true }
    }

    const cfg = yaml.load(fs.readFileSync(relayYaml, 'utf-8')) as Record<string, unknown>
    return { content: [jsonText({ status: 'ready', project_path: projectPath, name: cfg.name, slug: cfg.slug, version: cfg.version, message: '배포 준비 완료. relay-publish 프롬프트로 전체 워크플로우를 실행하세요.' })] }
  })

  // ═══ Prompts ═══

  server.prompt('relay-install', '에이전트 검색 → 설치 가이드 워크플로우', {}, () => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: `다음 가이드를 따라 에이전트를 설치하세요. relay MCP tool을 사용하여 각 단계를 실행합니다.

사용 가능한 tool: relay_status, relay_search, relay_install, relay_list, relay_status

## 워크플로우

1. relay_status로 로그인 상태 확인. 미인증이면 사용자에게 터미널에서 \`npx relayax-cli login --device\` 실행을 안내.
2. 사용자에게 어떤 에이전트를 찾는지 물어보기.
3. relay_search로 검색.
4. 검색 결과를 보여주고 선택하게 하기.
5. relay_install로 설치.
6. 설치 결과와 사용법 안내.` },
    }],
  }))

  server.prompt('relay-publish', '에이전트 배포 가이드 워크플로우', {}, () => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: `다음 가이드를 따라 에이전트를 배포하세요. relay MCP tool을 사용합니다.

사용 가능한 tool: relay_status, relay_scan, relay_status, relay_publish

## 워크플로우

1. relay_status로 로그인 상태 확인. 미인증이면 터미널에서 \`npx relayax-cli login --device\` 안내.
2. relay_scan으로 배포 가능한 스킬/에이전트/커맨드 목록 스캔.
3. 스캔 결과를 보여주고 사용자에게 어떤 항목을 배포할지 선택하게 하기.
4. relay_status로 프로젝트 상태 확인. .relay/relay.yaml이 없으면 프로젝트 생성 안내.
5. relay_publish로 배포.
6. 배포 결과를 사용자에게 보여주기.` },
    }],
  }))

  server.prompt('relay-status', '환경 상태 확인', {}, () => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: 'relay_status, relay_status, relay_list, relay_scan tool을 사용하여 현재 relay 환경 상태를 확인하고 사용자에게 보여주세요. 로그인 상태, 감지된 AI 도구, 프로젝트 정보, 설치된 에이전트, 배포 가능한 스킬 목록을 포함합니다.' },
    }],
  }))

  server.prompt('relay-uninstall', '에이전트 제거 가이드', {}, () => ({
    messages: [{
      role: 'user',
      content: { type: 'text', text: `다음 워크플로우를 따라 에이전트를 제거하세요:

1. relay_list로 설치된 에이전트 목록 표시.
2. 사용자에게 제거할 에이전트 선택하게 하기.
3. relay_uninstall로 제거.
4. 결과 보여주기.` },
    }],
  }))

  return server
}

// ─── Start ───

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
