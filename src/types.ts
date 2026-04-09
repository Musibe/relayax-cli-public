export interface ContactItem {
  type: string;
  label: string;
  value: string;
}

export interface InstalledAgent {
  /** agent UUID — used for server communication (install count, pings) */
  agent_id?: string;
  version: string;
  installed_at: string;
  files: string[];
  type?: 'agent' | 'system';
  /** Org slug if agent belongs to an org */
  org_slug?: string;
  /** Deploy scope — recorded via relay deploy-record */
  deploy_scope?: 'global' | 'local';
  /** Absolute paths of deployed files — recorded via relay deploy-record (legacy) */
  deployed_files?: string[];
  /** Absolute symlink paths — recorded by relay install */
  deployed_symlinks?: string[];
  /** Install source: registry (default), local:<path>, git:<url>#<ref>, link:<path>, adopted:<path> */
  source?: string;
}

/** Key is scoped slug format: "@owner/name" */
export interface InstalledRegistry {
  [scopedSlug: string]: InstalledAgent;
}

export interface AgentRegistryInfo {
  /** agent UUID */
  id: string;
  /** Scoped slug format: "@owner/name" */
  slug: string;
  name: string;
  description?: string;
  version: string;
  package_url: string;
  git_url?: string;
  commands: { name: string; description: string }[];
  type?: 'command' | 'passive' | 'hybrid';
  /** Recommended install scope by the agent author */
  recommended_scope?: 'global' | 'local';
  agent_details?: { name: string; description: string; uses: string[] }[];
  skill_details?: { name: string; description: string; uses: string[] }[];
  component_agents: number;
  component_rules: number;
  component_skills: number;
  tags?: string[];
  install_count?: number;
  requires?: Record<string, unknown>;
  visibility?: "public" | "internal" | "private";
  welcome?: string | null;
  contact?: Record<string, string> | null;
  author?: {
    username: string;
    display_name: string | null;
    contact_links: ContactItem[] | Record<string, string>;
  } | null;
}

// ─── Cloud Deploy Types ───

export interface AgentDefinition {
  system?: string
  tools?: string[]
  skills?: { name: string }[]
  mcp_servers?: { name: string; url?: string }[]
}

export interface AnthropicCloudConfig {
  model: string
  networking?: 'unrestricted' | 'limited'
  allowed_hosts?: string[]
}

export interface CloudConfig {
  anthropic?: AnthropicCloudConfig
  [provider: string]: unknown
}

export interface LocalConfig {
  commands?: { name: string; description?: string }[]
  scope?: 'global' | 'local'
  harnesses?: string[]
}

export interface DeployRecord {
  agent_id: string
  agent_version: number
  environment_id: string
  skill_ids: string[]
  deployed_at: string
  manifest_hash: string
}

export interface DeployRegistry {
  [scopedSlug: string]: {
    [provider: string]: DeployRecord
  }
}

export interface SearchResult {
  /** Scoped slug format: "@owner/name" */
  slug: string;
  name: string;
  description: string;
  commands: string[];
  install_count: number;
}
