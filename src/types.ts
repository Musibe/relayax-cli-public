export interface ContactItem {
  type: string;
  label: string;
  value: string;
}

export interface InstalledTeam {
  /** team UUID — 설치 카운트/핑 등 서버 통신에 사용 */
  team_id?: string;
  version: string;
  installed_at: string;
  files: string[];
  type?: 'team' | 'system';
  /** Org 소속 팀인 경우 Org slug */
  org_slug?: string;
  /** 배치 범위 — 에이전트가 relay deploy-record로 기록 */
  deploy_scope?: 'global' | 'local';
  /** 배치된 파일 절대경로 목록 — 에이전트가 relay deploy-record로 기록 */
  deployed_files?: string[];
}

/** 키는 scoped slug 포맷: "@owner/name" */
export interface InstalledRegistry {
  [scopedSlug: string]: InstalledTeam;
}

export interface TeamRegistryInfo {
  /** team UUID */
  id: string;
  /** scoped slug 포맷: "@owner/name" */
  slug: string;
  name: string;
  description?: string;
  version: string;
  package_url: string;
  commands: { name: string; description: string }[];
  type?: 'command' | 'passive' | 'hybrid';
  agent_details?: { name: string; description: string; uses: string[] }[];
  skill_details?: { name: string; description: string; uses: string[] }[];
  component_agents: number;
  component_rules: number;
  component_skills: number;
  tags?: string[];
  install_count?: number;
  requires?: Record<string, unknown>;
  visibility?: "public" | "gated" | "private";
  welcome?: string | null;
  contact?: Record<string, string> | null;
  author?: {
    username: string;
    display_name: string | null;
    contact_links: ContactItem[] | Record<string, string>;
  } | null;
}

export interface SearchResult {
  /** scoped slug 포맷: "@owner/name" */
  slug: string;
  name: string;
  description: string;
  commands: string[];
  install_count: number;
}
