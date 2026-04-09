/**
 * Cloud provider interface for deploying agents.
 * First implementation: Anthropic Managed Agents.
 * Extensible to OpenAI, Google, AWS, etc.
 */

export interface SkillDir {
  name: string
  /** Absolute path to the skill directory (contains SKILL.md) */
  path: string
  /** All file paths within the skill directory */
  files: string[]
}

export interface UploadedSkill {
  skill_id: string
  name: string
}

export interface EnvironmentConfig {
  name: string
  packages: Record<string, string[]>
  networking: 'unrestricted' | 'limited'
  allowed_hosts?: string[]
}

export interface AgentConfig {
  name: string
  model: string
  system?: string
  tools?: string[]
  skill_ids?: string[]
  mcp_servers?: { name: string; url?: string }[]
}

export interface DeploymentStatus {
  agent_id: string
  agent_version: number
  environment_id: string
  status: 'active' | 'archived' | 'unknown'
}

export interface CloudProvider {
  name: string

  /** Validate that the API key is valid */
  validateCredentials(): Promise<boolean>

  /** Upload skill directories to the provider */
  uploadSkills(skillDirs: SkillDir[]): Promise<UploadedSkill[]>

  /** Create a container environment */
  createEnvironment(config: EnvironmentConfig): Promise<string>

  /** Create an agent */
  createAgent(config: AgentConfig): Promise<{ agent_id: string; version: number }>

  /** Update an existing agent */
  updateAgent(agentId: string, version: number, config: AgentConfig): Promise<{ agent_id: string; version: number }>

  /** Get deployment status */
  getDeployment(agentId: string): Promise<DeploymentStatus | null>
}
