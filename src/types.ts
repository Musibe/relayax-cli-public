export interface ContactItem {
  type: string;
  label: string;
  value: string;
}

export interface InstalledAgent {
  /** agent UUID — 설치 카운트/핑 등 서버 통신에 사용 */
  agent_id?: string;
  version: string;
  installed_at: string;
  files: string[];
  type?: 'agent' | 'system';
  /** Org 소속 에이전트인 경우 Org slug */
  org_slug?: string;
  /** 배치 범위 — 에이전트가 relay deploy-record로 기록 */
  deploy_scope?: 'global' | 'local';
  /** 배치된 파일 절대경로 목록 — 에이전트가 relay deploy-record로 기록 (legacy) */
  deployed_files?: string[];
  /** symlink 절대경로 목록 — relay install이 직접 기록 */
  deployed_symlinks?: string[];
  /** 설치 소스: registry (기본), local:<path>, git:<url>#<ref>, link:<path>, adopted:<path> */
  source?: string;
}

/** 키는 scoped slug 포맷: "@owner/name" */
export interface InstalledRegistry {
  [scopedSlug: string]: InstalledAgent;
}

export interface AgentRegistryInfo {
  /** agent UUID */
  id: string;
  /** scoped slug 포맷: "@owner/name" */
  slug: string;
  name: string;
  description?: string;
  version: string;
  package_url: string;
  git_url?: string;
  commands: { name: string; description: string }[];
  type?: 'command' | 'passive' | 'hybrid';
  /** 에이전트 제작자가 권장하는 배치 범위 */
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
  /** scoped slug 포맷: "@owner/name" */
  slug: string;
  name: string;
  description: string;
  commands: string[];
  install_count: number;
}
