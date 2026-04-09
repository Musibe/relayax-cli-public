import fs from 'fs'
import path from 'path'
import type { CloudProvider, SkillDir, UploadedSkill, EnvironmentConfig, AgentConfig, DeploymentStatus } from './provider.js'

const BETA_HEADER = 'managed-agents-2026-04-01'
const API_BASE = 'https://api.anthropic.com/v1'

export class AnthropicProvider implements CloudProvider {
  name = 'anthropic'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'content-type': 'application/json',
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/agents?limit=1`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async uploadSkills(skillDirs: SkillDir[]): Promise<UploadedSkill[]> {
    const results: UploadedSkill[] = []

    for (const skill of skillDirs) {
      const formData = new FormData()
      formData.append('display_title', skill.name)

      for (const filePath of skill.files) {
        const relativePath = path.relative(skill.path, filePath)
        const content = fs.readFileSync(filePath)
        const blob = new Blob([content])
        // Use skill directory name as top-level so files are in same top-level dir
        formData.append('files', blob, path.join(skill.name, relativePath))
      }

      const res = await fetch(`${API_BASE}/skills`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': BETA_HEADER,
        },
        body: formData,
        signal: AbortSignal.timeout(30000),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Failed to upload skill "${skill.name}": ${res.status} ${body}`)
      }

      const data = (await res.json()) as { id: string }
      results.push({ skill_id: data.id, name: skill.name })
    }

    return results
  }

  async createEnvironment(config: EnvironmentConfig): Promise<string> {
    const body: Record<string, unknown> = {
      name: config.name,
      config: {
        type: 'cloud',
        networking: { type: config.networking },
      },
    }

    // Add packages if any
    const cfgObj = body.config as Record<string, unknown>
    if (Object.keys(config.packages).length > 0) {
      cfgObj.packages = config.packages
    }

    // Add allowed_hosts for limited networking
    if (config.networking === 'limited' && config.allowed_hosts?.length) {
      (cfgObj.networking as Record<string, unknown>).allowed_hosts = config.allowed_hosts
    }

    const res = await fetch(`${API_BASE}/environments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Failed to create environment: ${res.status} ${errBody}`)
    }

    const data = (await res.json()) as { id: string }
    return data.id
  }

  async createAgent(config: AgentConfig): Promise<{ agent_id: string; version: number }> {
    const tools: unknown[] = []

    // Build toolset config
    if (config.tools && config.tools.length > 0) {
      const allTools = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'web_fetch', 'web_search']
      const enabledSet = new Set(config.tools)

      // If not all tools are enabled, use selective enabling
      if (config.tools.length < allTools.length) {
        tools.push({
          type: 'agent_toolset_20260401',
          default_config: { enabled: false },
          configs: config.tools.map(t => ({ name: t, enabled: true })),
        })
      } else {
        tools.push({ type: 'agent_toolset_20260401' })
      }
    } else {
      // Enable all tools by default
      tools.push({ type: 'agent_toolset_20260401' })
    }

    const body: Record<string, unknown> = {
      name: config.name,
      model: config.model,
      tools,
    }

    if (config.system) body.system = config.system

    if (config.skill_ids?.length) {
      body.skills = config.skill_ids.map(id => ({
        type: 'custom',
        skill_id: id,
        version: 'latest',
      }))
    }

    if (config.mcp_servers?.length) {
      body.mcp_servers = config.mcp_servers.map(s => ({
        name: s.name,
        url: s.url,
      }))
    }

    const res = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Failed to create agent: ${res.status} ${errBody}`)
    }

    const data = (await res.json()) as { id: string; version: number }
    return { agent_id: data.id, version: data.version }
  }

  async updateAgent(agentId: string, version: number, config: AgentConfig): Promise<{ agent_id: string; version: number }> {
    const body: Record<string, unknown> = { version }

    if (config.system) body.system = config.system
    if (config.model) body.model = config.model

    if (config.skill_ids?.length) {
      body.skills = config.skill_ids.map(id => ({
        type: 'custom',
        skill_id: id,
        version: 'latest',
      }))
    }

    const res = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Failed to update agent: ${res.status} ${errBody}`)
    }

    const data = (await res.json()) as { id: string; version: number }
    return { agent_id: data.id, version: data.version }
  }

  async getDeployment(agentId: string): Promise<DeploymentStatus | null> {
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) return null

      const data = (await res.json()) as { id: string; version: number; archived_at: string | null }
      return {
        agent_id: data.id,
        agent_version: data.version,
        environment_id: '', // Would need to track separately
        status: data.archived_at ? 'archived' : 'active',
      }
    } catch {
      return null
    }
  }
}
