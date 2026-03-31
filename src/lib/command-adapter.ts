import os from 'os'
import path from 'path'
import type { AITool } from './ai-tools.js'
import { EXPLORE_PROMPT, CREATE_PROMPT, ERROR_HANDLING_GUIDE } from '../prompts/index.js'

/**
 * 환경 감지 프리앰블.
 * slash command 실행 시 MCP tool 사용 가능 여부를 먼저 판별하여,
 * 이후 모든 CLI 명령어를 적절한 방식으로 실행하도록 안내.
 */
const ENV_PREAMBLE = `## 환경 감지

이 커맨드를 실행하기 전에 환경을 판별하세요:

1. **relay MCP tool 사용 가능 여부 확인**: relay_status 같은 relay MCP tool을 호출할 수 있는지 확인하세요.
   - 사용 가능 → **MCP 모드**로 실행 (아래 표 참고)
   - 사용 불가 → **CLI 모드**로 실행 (bash 명령어 그대로 사용)

2. MCP 모드에서의 명령어 변환:

| CLI 명령어 | MCP tool |
|---|---|
| \`relay status\` | \`relay_status\` tool 호출 |
| \`relay list --json\` | \`relay_list\` tool 호출 |
| \`relay search <keyword>\` | \`relay_search\` tool 호출 |
| \`relay install <slug>\` | \`relay_install\` tool 호출 |
| \`relay uninstall <slug>\` | \`relay_uninstall\` tool 호출 |
| \`relay package --init\` | \`relay_scan\` tool 호출 |
| \`relay publish\` | \`relay_publish\` tool 호출 |
| \`relay login\` | \`relay_login\` tool 호출 |

**중요**: 이후 지시에서 \`relay <명령어>\`로 표기된 것은 판별된 환경에 따라 변환하여 실행하세요.

---

`

export interface CommandContent {
  id: string
  description: string
  body: string
}

export interface ToolCommandAdapter {
  toolId: string
  getFilePath(commandId: string): string
  formatFile(content: CommandContent): string
}

/**
 * 로컬 어댑터 — 프로젝트 디렉토리 기준.
 * {projectPath}/{skillsDir}/commands/relay/{id}.md
 */
export function createAdapter(tool: AITool): ToolCommandAdapter {
  return {
    toolId: tool.value,
    getFilePath(commandId: string): string {
      return path.join(tool.skillsDir, 'commands', 'relay', `${commandId}.md`)
    },
    formatFile: formatCommandFile,
  }
}

/**
 * @deprecated getGlobalCommandPathForTool(skillsDir, commandId)를 사용하세요.
 * Claude Code 전용 경로. 멀티 에이전트 지원 시 ForTool 버전 사용 필요.
 */
export function getGlobalCommandPath(commandId: string): string {
  return getGlobalCommandPathForTool('.claude', commandId)
}

/**
 * @deprecated getGlobalCommandDirForTool(skillsDir)를 사용하세요.
 * Claude Code 전용 경로. 멀티 에이전트 지원 시 ForTool 버전 사용 필요.
 */
export function getGlobalCommandDir(): string {
  return getGlobalCommandDirForTool('.claude')
}

/**
 * 특정 AI 도구의 글로벌 커맨드 디렉토리.
 * ~/{skillsDir}/commands/relay/
 */
export function getGlobalCommandDirForTool(skillsDir: string): string {
  return path.join(os.homedir(), skillsDir, 'commands', 'relay')
}

/**
 * 특정 AI 도구의 글로벌 커맨드 파일 경로.
 */
export function getGlobalCommandPathForTool(skillsDir: string, commandId: string): string {
  return path.join(os.homedir(), skillsDir, 'commands', 'relay', `${commandId}.md`)
}

/**
 * 커맨드 콘텐츠를 파일 형식으로 포맷.
 */
export function formatCommandFile(content: CommandContent): string {
  return `---\ndescription: ${content.description}\n---\n\n${content.body}\n`
}

// ─── 프롬프트는 cli/src/prompts/*.md에서 관리 (SSOT) ───

// ─── User Commands (글로벌 설치) ───

export const USER_COMMANDS: CommandContent[] = [
  {
    id: 'relay-explore',
    description: 'relay 마켓플레이스를 탐색하고 프로젝트에 맞는 에이전트를 찾습니다',
    body: EXPLORE_PROMPT,
  },
  {
    id: 'relay-status',
    description: '설치된 에이전트와 Organization 현황을 확인합니다',
    body: ENV_PREAMBLE + `현재 설치된 에이전트와 소속 Organization 현황을 한눈에 보여줍니다.

## 실행 방법

### 1. 설치된 에이전트 목록

\`relay list --json\` 명령어를 실행합니다.

**JSON 응답 구조:**
\`\`\`json
{
  "installed": [
    {
      "slug": "@author/agent-name",
      "version": "1.2.0",
      "installed_at": "2026-03-20T12:00:00.000Z",
      "scope": "global",
      "deploy_scope": "global",
      "org_slug": null
    }
  ]
}
\`\`\`

**각 에이전트를 아래 형식으로 표시:**

| 에이전트 | 버전 | 배포 | 설치일 |
|---|---|---|---|
| @author/agent-name | v1.2.0 | 글로벌 | 3/20 |

- \`deploy_scope\`가 \`"global"\` → 글로벌, \`"local"\` → 로컬, 없으면 → 미배치
- \`org_slug\`가 있으면 \`[Org: slug]\` 표시

### 2. Organization 목록

\`relay orgs list --json\` 명령어를 실행합니다.

**JSON 응답 구조:**
\`\`\`json
{
  "orgs": [
    {
      "slug": "my-org",
      "name": "내 조직",
      "description": "설명",
      "role": "owner"
    }
  ]
}
\`\`\`

**표시:**
- \`role\`: owner → 오너, admin → 관리자, builder → 빌더, member → 멤버
${ERROR_HANDLING_GUIDE}
- Org 조회 실패해도 설치된 에이전트 목록은 정상 표시합니다 (로컬 데이터).

### 3. Org 에이전트 목록 (옵션)
- \`--org <slug>\` 인자가 있으면: \`relay list --org <org-slug> --json\`으로 해당 Organization의 에이전트 목록도 보여줍니다.

### 4. 안내
- 설치된 에이전트가 없으면 \`/relay-explore\`로 에이전트를 탐색해보라고 안내합니다.
- Org가 있으면 활용법을 안내합니다:
  - Org 에이전트 설치: \`relay install @<org-slug>/<agent>\`
  - Org 관리: www.relayax.com/orgs/<slug>

## 예시

사용자: /relay-status
→ relay list --json 실행
→ relay orgs list --json 실행 (병렬 가능)

**설치된 에이전트 (2개)**

| 에이전트 | 버전 | 배포 | 설치일 |
|---|---|---|---|
| @alice/doc-writer | v1.2.0 | 글로벌 | 3/20 |
| @bob/code-reviewer | v0.5.1 | 로컬 | 3/15 |

**내 Organization (2개)**
- acme-corp — Acme Corp (소유자)
- dev-guild — Dev Guild (멤버)

사용자: /relay-status --org acme-corp
→ 위 정보 + \`relay list --org acme-corp --json\` 실행
→ acme-corp Organization에서 설치 가능한 에이전트 목록 추가 표시`,
  },
  {
    id: 'relay-uninstall',
    description: '설치된 에이전트를 삭제합니다',
    body: ENV_PREAMBLE + `설치된 에이전트를 제거합니다. CLI가 패키지와 배치된 파일을 모두 정리합니다.

## 실행 방법

1. \`relay uninstall <@author/slug> --json\` 명령어를 실행합니다.
2. CLI가 자동으로 처리하는 것:
   - \`.relay/agents/\` 패키지 삭제
   - \`deployed_files\`에 기록된 배치 파일 삭제 (에이전트 설정 디렉토리 내)
   - 빈 상위 디렉토리 정리
   - installed.json에서 항목 제거 (글로벌/로컬 양쪽)
3. 삭제 결과를 보여줍니다 (에이전트 이름, 제거된 파일 수).

## 예시

사용자: /relay-uninstall @alice/doc-writer
→ relay uninstall @alice/doc-writer --json 실행
→ "✓ @alice/doc-writer 삭제 완료 (12개 파일 제거)"`,
  },
  {
    id: 'relay-create',
    description: '에이전트를 만들거나 업데이트하여 relay에 배포합니다',
    body: CREATE_PROMPT,
  },
]

// ─── Builder Commands (로컬 설치) ───
// relay-publish가 글로벌로 승격되어 현재 비어있음.
// relay init --auto만 실행하면 모든 커맨드가 한번에 업데이트됨.

export const BUILDER_COMMANDS: CommandContent[] = []

