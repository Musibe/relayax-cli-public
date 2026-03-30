import os from 'os'
import path from 'path'
import type { AITool } from './ai-tools.js'

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
 * 글로벌 슬래시 커맨드 파일 경로 (Claude Code 기본).
 * ~/.claude/commands/relay/{id}.md
 */
export function getGlobalCommandPath(commandId: string): string {
  return path.join(os.homedir(), '.claude', 'commands', 'relay', `${commandId}.md`)
}

/**
 * 글로벌 슬래시 커맨드 디렉토리 (Claude Code 기본).
 */
export function getGlobalCommandDir(): string {
  return path.join(os.homedir(), '.claude', 'commands', 'relay')
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

// ─── 에러 처리 가이드 (결정적 실행 + 비결정적 조율) ───

const ERROR_HANDLING_GUIDE = `
### 에러 처리 가이드

CLI 명령 실행 후 JSON 에러가 반환되면 아래 기준에 따라 처리합니다.
**원칙: "되돌릴 수 없는 영향이 있는가?"로 판단합니다.**

#### 1. 자동 해결 (사용자에게 물어보지 않음)
되돌릴 수 있고, 부작용 없는 에러:

| 에러 코드 | 행동 |
|-----------|------|
| \`LOGIN_REQUIRED\` / \`NO_TOKEN\` | \`relay login\` 실행 (timeout 300초, 브라우저 자동 열림) → 성공 후 원래 명령 재시도 |
| \`NOT_INITIALIZED\` | \`relay init --all --json\` 실행 → 원래 명령 재시도 |
| \`FETCH_FAILED\` | 3초 대기 후 원래 명령 재시도 (최대 2회). 2회 실패 시 사용자에게 안내 |

#### 2. 사용자에게 선택지 제시 (AskUserQuestion)
\`options\` 필드가 있는 에러:

| 에러 코드 | 행동 |
|-----------|------|
| \`MISSING_VISIBILITY\` | options의 label을 선택지로 AskUserQuestion 호출 |
| \`MISSING_FIELD\` | fix 안내 + 사용자에게 값 입력 요청 |
| \`MISSING_TOOLS\` | options의 감지된 도구 목록을 선택지로 AskUserQuestion 호출 |
| \`MISSING_SPACE\` | options의 Space 목록을 선택지로 AskUserQuestion 호출 |

사용자가 선택하면, 선택된 값을 CLI 플래그에 반영하여 명령을 재호출합니다.

#### 3. 사용자에게 안내 (되돌릴 수 없는 에러)
구매, 접근 권한, 보안 관련:

| 에러 코드 | 행동 |
|-----------|------|
| \`GATED_ACCESS_REQUIRED\` | purchase_info의 message/url 표시 → "접근 코드가 있으신가요?" AskUserQuestion |
| \`SPACE_ONLY\` | Space 가입 필요 안내 → "초대 코드가 있으신가요?" AskUserQuestion |
| \`APPROVAL_REQUIRED\` | 승인 대기 안내 |
| \`NO_ACCESS\` | 접근 방법 안내 |

#### 4. 그 외 에러
\`fix\` 필드의 메시지를 사용자에게 전달하고, 필요하면 다음 행동을 제안합니다.`

// ─── 명함 표시 포맷 ───

const BUSINESS_CARD_FORMAT = `
### 빌더 명함 표시
JSON 결과의 \`author\`, \`welcome\` 필드를 사용하여 명함을 표시합니다.
불릿 리스트(- 또는 *)로 나열하지 마세요. 반드시 인용 블록(>) 안에 넣어야 합니다.

**JSON 결과에서 사용할 필드:**
- \`author.display_name\` 또는 \`author.username\` → 명함 제목
- \`welcome\` → 환영 메시지 (💬)
- \`author.contact_links\` → 연락처 배열 (\`[{type, label, value}]\`)
- \`author.username\` → 프로필 링크 (👤)

**예시 (이 형태를 그대로 따르세요):**

JSON 결과 예시:
\`\`\`json
{
  "author": { "username": "alice", "display_name": "Alice Kim", "contact_links": [
    {"type": "email", "label": "이메일", "value": "alice@example.com"},
    {"type": "website", "label": "블로그", "value": "https://alice.dev"},
    {"type": "kakao", "label": "카카오", "value": "https://open.kakao.com/o/abc123"}
  ]},
  "welcome": "안녕하세요!\\n에이전트 빌더 Alice입니다.\\n설치해주셔서 감사합니다."
}
\`\`\`

출력:

> **🪪 Alice Kim의 명함**
>
> 💬 "안녕하세요!
> 에이전트 빌더 Alice입니다.
> 설치해주셔서 감사합니다."
>
> 📧 alice@example.com
> 🔗 블로그: alice.dev
> 💬 카카오: open.kakao.com/o/abc123
> 👤 relayax.com/@alice

- \`welcome\`이 없으면 💬 줄을 생략합니다.
- 연락처의 type에 맞는 이모지: 📧 email, 💬 kakao, 🐦 x, 💼 linkedin, 💻 github, 🔗 website/custom
- 연락처가 여러 개면 각각 한 줄씩 표시합니다.
- \`author\`가 null이면 명함 블록 전체를 생략합니다.`

// ─── User Commands (글로벌 설치) ───

export const USER_COMMANDS: CommandContent[] = [
  {
    id: 'relay-install',
    description: 'relay Space에서 에이전트 팀을 설치합니다',
    body: `요청된 에이전트 팀을 relay Space에서 다운로드하고, 현재 에이전트 환경에 맞게 구성합니다.
인자 없이 호출하면 인터랙티브 탐색 모드로 진입합니다.

## 인터랙션 플로우

이 커맨드는 3단계 인터랙션으로 진행됩니다. 각 단계에서 반드시 AskUserQuestion 도구를 사용하세요.

### Step 1. Space 선택 & 팀 탐색 (slug가 없을 때만)

slug가 직접 주어지면 (\`/relay-install @alice/doc-writer\`) 이 단계를 건너뛰고 Step 2로 갑니다.

#### 1-1. Space 선택
\`relay spaces --json\` 을 실행하여 사용자의 Space 목록을 가져옵니다.

**AskUserQuestion 호출:**
- question: "어디서 팀을 찾을까요?"
- options: Space가 있으면 \`["<space1_name>", "<space2_name>", ...]\`, 없으면 이 단계를 건너뛰고 바로 내 Space 탐색으로 진행

**응답 처리:**
- Space 이름 선택 → 1-2. Space 팀 탐색으로 진행

#### 1-2. Space 팀 탐색
선택된 Space에서 팀을 검색합니다.
\`relay search <keyword>\` 명령어를 실행합니다 (필요하면 여러 키워드로 반복).
또는 \`relay list --space <space-slug> --json\`으로 전체 목록을 가져옵니다.

검색 결과를 번호 리스트로 보여줍니다:

\`\`\`
검색 결과 (3개)

1. @alice/doc-writer — 기술 문서 자동화
   /write-doc, /api-doc

2. @bob/code-reviewer — PR 리뷰 자동화
   /review, /suggest

3. @carol/test-gen — 테스트 코드 생성
   /gen-test, /coverage
\`\`\`

**AskUserQuestion 호출:**
- question: "어떤 팀을 설치할까요?"
- options: \`["1", "2", "3", "다시 검색", "돌아가기"]\`

"다시 검색" → 새 키워드로 1-2 반복
"돌아가기" → 1-1로 돌아감
번호 선택 → 해당 팀의 slug로 설치 진행

#### 1-3. Space 팀 목록 (전체 보기)
\`relay list --space <space-slug> --json\` 을 실행합니다.

팀 목록을 번호 리스트로 보여줍니다 (1-2와 동일 형식).

**AskUserQuestion 호출:**
- question: "어떤 팀을 설치할까요?"
- options: \`["1", "2", ..., "돌아가기"]\`

"돌아가기" → 1-1로 돌아감
번호 선택 → 해당 팀의 slug로 설치 진행

### Step 2. 설치 & 배치 범위 선택

#### 2-1. 패키지 다운로드
\`relay install <@space/team> --json\` 명령어를 실행합니다.
- 공개 팀 (public): \`relay install <@space/team> --json\`
- 링크 공유 팀 (gated): \`relay install <slug> --json\`
  - 접근 권한이 없으면 CLI가 **purchase_info** (구매 안내 메시지 + URL)를 표시합니다.
  - 접근 링크 코드가 있으면: \`relay access <slug> --code <code>\` 로 접근 부여 + 자동 설치를 한번에 수행합니다.
  - Space 멤버이면 접근 확인 없이 바로 설치됩니다.
- Space 팀 (비공개/private): \`relay install @<space-slug>/<team-slug> --json\`
  - Space 가입이 필요하면: \`relay join <space-slug> --code <invite-code>\` 를 먼저 실행합니다.
  - 또는 \`--join-code <code>\`로 가입+설치를 한번에 할 수 있습니다.
- CLI가 init과 login을 자동으로 처리합니다 (사용자가 별도 실행할 필요 없음).
- JSON 출력에서 \`install_path\` (패키지 경로)를 확인합니다.

**gated 팀 접근 거부 처리:**
- CLI가 403 + \`GATED_ACCESS_REQUIRED\` 에러를 반환하면:
  1. purchase_info의 message와 url을 사용자에게 표시합니다.
  2. "접근 링크 코드가 있으신가요?"라고 물어봅니다.
  3. 코드가 있으면 \`relay access <slug> --code <code>\`를 실행합니다.
  4. 코드가 없으면 purchase_info의 url로 구매 안내합니다.

#### 2-2. 배치 범위 선택 (추천 포함)

팀의 성격을 분석하여 글로벌/로컬 중 적합한 쪽을 추천합니다.

**추천 로직:**
- **글로벌 추천** — 범용 유틸리티 팀: 코드 리뷰, 문서 생성, 테스트, 번역 등 프로젝트에 무관하게 사용하는 도구성 팀
- **로컬 추천** — 프로젝트 특화 팀: 특정 프레임워크/스택 전용, 프로젝트별 워크플로우, 팀 내부 컨벤션에 의존하는 팀

판단 기준 (다운로드된 패키지의 relay.yaml과 콘텐츠를 분석):
1. \`tags\`에 특정 프레임워크/스택 키워드가 있으면 (nextjs, supabase, react 등) → 로컬 추천
2. \`requires\`에 프로젝트 종속 의존성이 있으면 (npm 패키지, 특정 파일 구조) → 로컬 추천
3. rules/ 파일이 있으면 (프로젝트 컨벤션 주입) → 로컬 추천
4. 범용 키워드 (utility, review, docs, testing 등) → 글로벌 추천
5. 판단이 어려우면 → 글로벌 추천 (기본값)

**AskUserQuestion 호출:**
- question: "{추천 이유}. {추천}에 설치할까요?"
- options: \`["글로벌 (모든 프로젝트) ✓ 추천", "로컬 (이 프로젝트만)"]\` 또는 \`["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만) ✓ 추천"]\`

예시:
- "범용 코드 리뷰 도구입니다. 글로벌에 설치할까요?" → \`["글로벌 (모든 프로젝트) ✓ 추천", "로컬 (이 프로젝트만)"]\`
- "Next.js + Supabase 전용 팀입니다. 이 프로젝트에 설치할까요?" → \`["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만) ✓ 추천"]\`

**응답 처리:**
- "글로벌" → \`~/.claude/\`에 배치
- "로컬" → 현재 프로젝트 \`.claude/\`에 배치

#### 2-3. 에이전트 환경에 맞게 배치
다운로드된 패키지(\`install_path\`)에서 파일을 읽고 선택된 범위에 배치합니다:
- 글로벌: \`<install_path>/commands/\` → \`~/.claude/commands/\`에 복사, skills/ 동일
- 로컬: \`<install_path>/commands/\` → \`.claude/commands/\`에 복사, skills/ 동일
- agents/, rules/ 파일도 같은 방식으로 배치합니다.
- **충돌 확인**: 같은 이름의 파일이 이미 있으면 사용자에게 덮어쓸지 물어봅니다.

#### 2-4. 배치 정보 기록 (필수)
배치 완료 후 반드시 \`relay deploy-record\`를 실행합니다:
\`\`\`
relay deploy-record <slug> --scope <global|local> --files <배치된_파일1> <배치된_파일2> ...
\`\`\`

#### 2-5. Requirements 체크리스트 (필수 — 항목이 있으면 반드시 수행)

\`<install_path>/relay.yaml\`의 \`requires\` 섹션을 읽고, **각 항목을 하나씩 확인하여 체크리스트로 표시**합니다.
requires 섹션이 없거나 비어있으면 이 단계를 건너뜁니다.

**출력 형식** (반드시 이 형식으로 사용자에게 보여줍니다):
\`\`\`
📋 Requirements 확인

[runtime]
  ✅ Node.js >=18 — v20.11.0 확인됨
  ❌ Python >=3.10 — v3.8.5 (업그레이드 필요)

[cli]
  ✅ playwright — 설치됨
  ❌ ffmpeg — 미설치 → 설치 명령: brew install ffmpeg

[npm]
  ✅ sharp — 설치됨
  ❌ puppeteer — 미설치 → 설치 중...

[env]
  ✅ OPENAI_API_KEY — 설정됨
  ❌ SLACK_WEBHOOK_URL (선택) — 미설정. 알림 전송에 필요

[mcp]
  ⚙️  supabase — MCP 서버 설정 필요 (아래 안내 참고)

[teams]
  ✅ @alice/doc-writer — 이미 설치됨
  📦 @bob/utils — 미설치 → 설치 중...
\`\`\`

**처리 규칙 (각 카테고리별):**

1. **runtime**: \`node --version\`, \`python3 --version\`으로 확인. 버전 미달이면 ❌ 표시 후 업그레이드 안내.
2. **cli**: \`which <name>\`으로 확인.
   - 설치됨 → ✅
   - 미설치 + \`install\` 필드 있음 → 사용자에게 설치할지 물어본 후 실행
   - 미설치 + \`install\` 필드 없음 → ❌ 표시 후 수동 설치 안내
3. **npm**: \`npm list <package> 2>/dev/null\`으로 확인.
   - 설치됨 → ✅
   - 미설치 + required → \`npm install <package>\` 실행
   - 미설치 + optional → ❌ 표시 후 안내만
4. **env**: \`echo $<NAME>\`으로 확인.
   - 설정됨 → ✅
   - 미설정 + required → ❌ 표시 후 \`description\`과 함께 설정 방법 안내
   - 미설정 + optional → ⚠️ 표시 후 용도 안내
5. **mcp**: MCP 서버 설정이 필요한 경우 ⚙️ 표시 후 설정 방법을 상세히 안내.
   - \`config\` 필드가 있으면 settings.json에 추가할 JSON 블록을 보여줍니다.
   - \`env\` 필드가 있으면 필요한 환경변수도 함께 안내합니다.
6. **teams**: \`relay list --json\`으로 설치 여부 확인.
   - 설치됨 → ✅
   - 미설치 → \`relay install <@author/team> --json\` 실행하여 재귀 설치

**중요**: 모든 required 항목이 ❌인 경우, 체크리스트 끝에 경고를 표시합니다:
\`\`\`
⚠️  필수 요구사항이 충족되지 않았습니다. 팀 기능이 제한될 수 있습니다.
\`\`\`
${ERROR_HANDLING_GUIDE}

### Step 3. 완료 & 팔로우 제안

#### 3-1. 완료 안내
- 배치된 파일과 활성화된 커맨드 목록을 보여줍니다.
${BUSINESS_CARD_FORMAT}

#### 3-2. 팔로우 제안 (필수 — 이 단계를 절대 건너뛰지 마세요)
명함 표시 직후, 빌더의 username이 JSON 결과에 있으면 **반드시** AskUserQuestion 도구를 호출하세요.

**AskUserQuestion 호출:**
- question: \`@{username}을 팔로우할까요? 새 버전 알림을 받을 수 있습니다.\`
- options: \`["팔로우", "건너뛰기"]\`

**응답 처리:**
- "팔로우" → \`relay follow @{username}\` 실행. 로그인이 안 되어 있으면 \`relay login\` 먼저 실행 후 재시도.
- "건너뛰기" → 다음 단계로 진행

#### 3-3. 공유 가이드 (필수 — 설치 완료 시 반드시 표시)
설치 완료 후 아래 공유용 설치 가이드를 표시합니다. 복사 가능한 코드 블록으로 보여줍니다.

\`\`\`
주변인에게 공유하세요:

아래 가이드를 읽고 그대로 따라해줘:
https://relayax.com/api/registry/{owner}/{slug}/guide.md
\`\`\`

- \`{slug}\`가 \`@owner/team\` 형식이면 \`{owner}\`과 \`{slug}\`를 분리하여 URL을 구성합니다.
- CLI가 이미 설치된 사용자를 위한 짧은 버전도 함께 표시합니다: \`/relay:relay-install {slug}\`

#### 3-4. 사용 제안
- "바로 사용해볼까요?" 제안

#### 3-5. 업데이트 확인
- \`relay check-update\` 명령어를 실행합니다.
- CLI 업데이트가 있으면 안내합니다: "relay v{new} available. Run: npm update -g relayax-cli"
- 다른 팀 업데이트가 있으면 안내합니다.

## 예시

### 인터랙티브 모드 (/relay-install)
→ relay spaces --json 실행
→ AskUserQuestion: "어디서 팀을 찾을까요?" → ["Alice's Space (alice)", "Acme Corp"]
→ "Alice's Space" 선택 → "어떤 팀을 찾고 계세요?"
→ relay search "문서" 실행 → 결과 리스트 표시
→ AskUserQuestion: "어떤 팀을 설치할까요?" → ["1", "2", "3", "다시 검색"]
→ "1" 선택 (@alice/doc-writer)
→ AskUserQuestion: "어디에 설치할까요?" → ["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만)"]
→ "글로벌" 선택
→ 설치 + 배치 + deploy-record
→ 명함 표시
→ AskUserQuestion: "@alice을 팔로우할까요?" → ["팔로우", "건너뛰기"]
→ "✓ 설치 완료! /write-doc를 사용해볼까요?"

### 다이렉트 모드 (/relay-install @alice/doc-writer)
→ relay install @alice/doc-writer --json 실행 (Step 1 건너뜀)
→ AskUserQuestion: "어디에 설치할까요?" → ["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만)"]
→ 설치 + 배치 + deploy-record
→ 명함 표시
→ AskUserQuestion: "@alice을 팔로우할까요?" → ["팔로우", "건너뛰기"]
→ "✓ 설치 완료! /write-doc를 사용해볼까요?"`,
  },
  {
    id: 'relay-status',
    description: '설치된 팀과 Space 현황을 확인합니다',
    body: `현재 설치된 에이전트 팀과 소속 Space 현황을 한눈에 보여줍니다.

## 실행 방법

### 1. 설치된 팀 목록

\`relay list --json\` 명령어를 실행합니다.

**JSON 응답 구조:**
\`\`\`json
{
  "installed": [
    {
      "slug": "@author/team-name",
      "version": "1.2.0",
      "installed_at": "2026-03-20T12:00:00.000Z",
      "scope": "global",
      "deploy_scope": "global",
      "org_slug": null
    }
  ]
}
\`\`\`

**각 팀을 아래 형식으로 표시:**

| 팀 | 버전 | 배포 | 설치일 |
|---|---|---|---|
| @author/team-name | v1.2.0 | 글로벌 | 3/20 |

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
- Org 조회 실패해도 설치된 팀 목록은 정상 표시합니다 (로컬 데이터).

### 3. Org 팀 목록 (옵션)
- \`--org <slug>\` 인자가 있으면: \`relay list --org <org-slug> --json\`으로 해당 Organization의 팀 목록도 보여줍니다.

### 4. 안내
- 설치된 팀이 없으면 \`/relay-install\`로 팀을 탐색·설치해보라고 안내합니다.
- Org가 있으면 활용법을 안내합니다:
  - Org 팀 설치: \`relay install @<org-slug>/<team>\`
  - Org 관리: www.relayax.com/orgs/<slug>

## 예시

사용자: /relay-status
→ relay list --json 실행
→ relay orgs list --json 실행 (병렬 가능)

**설치된 팀 (2개)**

| 팀 | 버전 | 배포 | 설치일 |
|---|---|---|---|
| @alice/doc-writer | v1.2.0 | 글로벌 | 3/20 |
| @bob/code-reviewer | v0.5.1 | 로컬 | 3/15 |

**내 Space (2개)**
- acme-corp — Acme Corp (소유자)
- dev-guild — Dev Guild (멤버)

사용자: /relay-status --space acme-corp
→ 위 정보 + \`relay list --space acme-corp --json\` 실행
→ acme-corp Space에서 설치 가능한 팀 목록 추가 표시`,
  },
  {
    id: 'relay-uninstall',
    description: '설치된 에이전트 팀을 삭제합니다',
    body: `설치된 에이전트 팀을 제거합니다. CLI가 패키지와 배치된 파일을 모두 정리합니다.

## 실행 방법

1. \`relay uninstall <@author/slug> --json\` 명령어를 실행합니다.
2. CLI가 자동으로 처리하는 것:
   - \`.relay/teams/\` 패키지 삭제
   - \`deployed_files\`에 기록된 배치 파일 삭제 (\`~/.claude/\` 또는 \`.claude/\`)
   - 빈 상위 디렉토리 정리
   - installed.json에서 항목 제거 (글로벌/로컬 양쪽)
3. 삭제 결과를 보여줍니다 (팀 이름, 제거된 파일 수).

## 예시

사용자: /relay-uninstall @alice/doc-writer
→ relay uninstall @alice/doc-writer --json 실행
→ "✓ @alice/doc-writer 삭제 완료 (12개 파일 제거)"`,
  },
  {
    id: 'relay-publish',
    description: '현재 팀 패키지를 relay Space에 배포합니다',
    body: `현재 디렉토리의 에이전트 팀(.relay/)을 분석하고, 보안 점검 및 requirements를 구성한 뒤, 사용가이드를 생성하고 relay Space에 배포합니다.

## 사전 준비

### 0-1. 인증 확인

- \`relay status --json\` 명령어를 실행하여 로그인 상태를 확인합니다.
- 인증되어 있으면 다음 단계로 진행합니다.
- 미인증이면 바로 로그인을 진행합니다:
  1. \`relay login\` 실행 (timeout 300초)
     - 브라우저가 자동으로 열리고, 사용자가 로그인을 완료하면 토큰이 자동 저장됩니다.
  2. 완료 후 \`relay status --json\`으로 로그인 성공을 확인합니다.

### 0-2. 소스 패키징 (source → .relay/)

\`relay package\` CLI 명령을 사용하여 소스 디렉토리의 콘텐츠를 .relay/로 동기화합니다.
소스 탐색과 파일 비교는 CLI가 결정적으로 처리하고, 에이전트는 결과를 사용자에게 보여주고 흐름을 조율합니다.

#### A. 최초 배포 (.relay/relay.yaml이 없음)

##### 1단계: 소스 탐색

\`relay package --init --json\` 실행
- CLI가 프로젝트에서 에이전트 CLI 디렉토리(.claude/, .codex/, .gemini/ 등)를 자동 탐색합니다.
- JSON 결과의 \`detected\` 배열에 각 디렉토리별 콘텐츠 요약이 포함됩니다:
  \`\`\`json
  {
    "status": "init_required",
    "detected": [
      { "source": ".claude", "name": "Claude Code", "summary": { "skills": 2, "commands": 3 }, "fileCount": 8 },
      { "source": ".codex", "name": "Codex", "summary": { "agents": 1 }, "fileCount": 2 }
    ]
  }
  \`\`\`

- **detected가 0개** → "배포 가능한 에이전트 콘텐츠가 없습니다. skills/이나 commands/를 먼저 만들어주세요." 안내 후 중단

##### 2단계: 콘텐츠 분석 & 팀 포지셔닝

detected된 소스 디렉토리의 skills/, commands/, agents/, rules/ 파일 **내용을 직접 읽어** 팀의 정체성을 파악합니다.

**분석 관점:**
- 이 팀이 **무엇을 하는 팀**인지 (코드 리뷰? QA? 문서 생성? 데이터 분석?)
- 어떤 **기술 스택/도메인**에 특화되어 있는지 (Supabase? React? Python?)
- 설치자에게 **어떤 가치**를 제공하는지

이 분석을 기반으로 팀을 하나의 "제품"으로 포지셔닝합니다.

**중요: 소스 디렉토리 이름(.claude 등)은 인프라 디테일이므로 사용자에게 노출하지 않습니다.**
사용자에게는 팀의 기능과 정체성 중심으로 질문합니다.

##### 3단계: 배포 제안

분석 결과를 바탕으로 팀 배포를 제안합니다.

**detected가 1개일 때:**

**AskUserQuestion 호출:**
- question: 콘텐츠 분석 기반의 포지셔닝 질문
- 예시:
  - "Supabase 웹 개발팀으로 배포할까요? (skills 2개, commands 3개)"
  - "코드 리뷰 자동화 팀으로 배포할까요? (skills 1개, agents 2개)"
  - "Next.js QA 테스트팀으로 배포할까요? (commands 5개)"
- options: \`["배포", "취소"]\`

**detected가 여러 개일 때:**
각 소스의 콘텐츠를 분석하여 서로 다른 팀으로 포지셔닝합니다.

**AskUserQuestion 호출:**
- question: "어떤 팀으로 배포할까요?"
- options: 콘텐츠 기반 설명 (예: \`["Supabase 웹 개발팀 (skills 2개, commands 3개)", "QA 자동화 에이전트 (agents 1개)"]\`)
- 디렉토리 이름은 내부적으로만 매핑하고, 사용자에게는 팀의 기능으로 보여줍니다.

##### 4단계: 팀 정보 확정

포지셔닝 분석을 기반으로 팀 이름과 설명을 제안합니다.

**AskUserQuestion 호출:**
- question: "팀 이름을 확인해주세요"
- 분석된 포지셔닝에서 자연스러운 팀 이름을 제안합니다 (예: "supabase-web-dev", "code-reviewer")
- 현재 디렉토리명이 아닌, **콘텐츠 기반** 이름을 기본값으로 제시합니다.

**AskUserQuestion 호출:**
- question: "팀 설명을 확인해주세요 (Space에 표시됩니다)"
- 분석한 콘텐츠를 기반으로 설치자 관점의 설명을 제안합니다.
- 좋은 예: "Supabase 기반 웹앱의 DB 마이그레이션, API 개발, 테스트를 자동화합니다"
- 나쁜 예: ".claude 디렉토리의 skills와 commands를 패키징한 팀"

##### 5단계: 초기화 & 패키징

자동 처리:
- \`.relay/relay.yaml\` 생성:
  \`\`\`yaml
  name: <확정된 이름>
  slug: <이름에서 자동 생성 — 소문자, 특수문자→하이픈>
  description: <확정된 설명>
  source: <선택된 소스 디렉토리> # 예: .claude (내부용)
  version: 1.0.0
  tags: []
  \`\`\`
- \`relay package --source <선택된 소스> --sync --json\` 실행하여 콘텐츠를 .relay/로 복사
- \`relay init --auto\` 실행하여 글로벌 커맨드 설치 보장
- 결과를 사용자에게 표시

#### B. 재배포 (.relay/relay.yaml이 있음)

1. \`relay package --json\` 실행
   - CLI가 relay.yaml의 \`source\` 필드를 읽고, 소스 디렉토리와 .relay/를 파일 해시로 비교합니다.
   - JSON 결과 예시:
     \`\`\`json
     {
       "source": ".claude",
       "sourceName": "Claude Code",
       "synced": false,
       "diff": [
         { "relPath": "skills/code-review/SKILL.md", "status": "modified" },
         { "relPath": "commands/deploy.md", "status": "added" },
         { "relPath": "commands/old-cmd.md", "status": "deleted" }
       ],
       "summary": { "added": 1, "modified": 1, "deleted": 1, "unchanged": 5 }
     }
     \`\`\`

2. **변경이 있으면** (added + modified + deleted > 0) → diff를 사용자에게 보여줍니다:
   \`\`\`
   📦 소스 동기화 (.claude/ → .relay/)
     변경: skills/code-review/SKILL.md
     신규: commands/deploy.md
     삭제: commands/old-cmd.md
     유지: 5개 파일
   \`\`\`

   **AskUserQuestion 호출:**
   - question: "소스 변경사항을 .relay/에 반영할까요?"
   - options: \`["반영", "변경 확인", "건너뛰기"]\`

   **응답 처리:**
   - "반영" → \`relay package --sync --json\` 실행하여 동기화
   - "변경 확인" → 변경된 파일의 내용을 직접 읽어 diff를 상세히 보여준 후 다시 AskUserQuestion
   - "건너뛰기" → 현재 .relay/ 그대로 배포

3. **변경이 없으면** → "✓ 소스와 동기화 상태입니다." 표시 후 다음 단계로

4. \`source\` 필드가 없으면 → .relay/ 내 콘텐츠를 직접 편집하는 모드로 간주하고 동기화를 건너뜁니다.

## 인터랙션 플로우

이 커맨드는 4단계 인터랙션으로 진행됩니다. 각 단계에서 반드시 AskUserQuestion 도구를 사용하세요.

### Step 1. 버전 범프

relay.yaml의 현재 \`version\`을 읽고 semver 범프를 제안합니다.

**AskUserQuestion 호출:**
- question: "버전을 올릴까요? (현재 v{version})"
- options: \`["v{patch} — patch (버그 수정)", "v{minor} — minor (기능 추가)", "v{major} — major (큰 변경)", "v{version} — 유지"]\`

예시: 현재 v1.0.0이면 → \`["v1.0.1 — patch", "v1.1.0 — minor", "v2.0.0 — major", "v1.0.0 — 유지"]\`

**응답 처리:**
- 유지 외 선택 → relay.yaml의 version을 선택된 값으로 업데이트
- 유지 → 그대로 진행

### Step 1. 공개 범위 선택

relay.yaml의 \`visibility\` 설정을 확인합니다.

#### 신규 배포 (visibility 미설정)

**AskUserQuestion 호출:**
- question: "공개 범위를 선택하세요"
- options: \`["공개 — 누구나 설치", "링크 공유 — 접근 링크가 있는 사람만 설치", "비공개 — Space 멤버만"]\`

**응답 처리:**
- "공개" → relay.yaml에 \`visibility: public\` 저장
- "링크 공유" → relay.yaml에 \`visibility: gated\` 저장. 배포 후 웹 대시보드(/dashboard)에서 접근 링크를 생성하고 구매 안내를 설정할 수 있다고 안내.
- "비공개" → \`relay spaces --json\` 실행 후 Space 목록 표시
  - Space가 0개이면: "비공개 배포하려면 Space가 필요합니다. www.relayax.com/spaces 에서 Space를 생성하세요."라고 안내하고 중단합니다.

  **AskUserQuestion 호출 (Space가 1개여도 반드시 호출):**
  - question: "어떤 Space에 배포할까요?"
  - options: \`["<space1_name>", "<space2_name>", ...]\`
  - **중요: Space가 1개라도 자동 선택하지 말고 반드시 사용자에게 확인받으세요.**

  → relay.yaml에 \`visibility: private\`, \`space: <selected_slug>\` 저장

#### 재배포 (visibility 이미 설정됨)

현재 설정을 확인합니다:

**AskUserQuestion 호출:**
- question: 공개일 때 "현재 **공개** 설정입니다. 유지할까요?", 링크공유일 때 "현재 **링크 공유** 설정입니다. 접근 링크가 있는 사람만 설치 가능합니다. 유지할까요?", 비공개일 때 "현재 **비공개** 설정입니다 (Space: {name}). 유지할까요?"
- options: \`["유지", "변경"]\`

"변경" → 신규 배포와 동일한 플로우

### Step 2. 보안 점검 & requires 확인

.relay/ 내 모든 파일을 자동 분석합니다.

#### 2-1. 시크릿 스캔 (자동)
- 하드코딩된 API 키, 토큰, 비밀번호, Private Key 등을 탐색합니다.
  - 예: sk-..., ghp_..., AKIA..., Bearer 토큰, JWT, -----BEGIN PRIVATE KEY----- 등
- 발견 시 **즉시 사용자에게 경고**하고, 환경변수로 대체하도록 안내합니다.
- 시크릿이 제거되지 않으면 배포를 진행하지 않습니다.

#### 2-2. 환경변수 & 의존성 분석 (자동)
분석 대상:
- **env**: 환경변수 참조 (process.env.*, \${VAR}, os.environ 등)
- **cli**: 참조하는 CLI 도구 (playwright, ffmpeg, sharp 등)
- **npm**: import/require되는 npm 패키지
- **mcp**: MCP 서버 설정
- **runtime**: Node.js/Python 등 최소 버전
- **teams**: 의존하는 다른 relay 팀

분석 결과를 요약 표시합니다:

\`\`\`
requires 분석 결과

환경변수:
  OPENAI_API_KEY — 필수 (LLM API 호출)
  SLACK_WEBHOOK_URL — 선택 (알림 전송)

CLI: playwright (필수)
npm: sharp (필수)
MCP: supabase (선택)
\`\`\`

**AskUserQuestion 호출:**
- question: "requires 설정이 맞나요?"
- options: \`["확인", "수정"]\`

**응답 처리:**
- "확인" → .relay/relay.yaml에 requires 섹션 저장, 다음 단계로
- "수정" → 사용자와 텍스트 대화로 수정 후 다시 확인

\`\`\`yaml
# .relay/relay.yaml requires 구조
requires:
  env:
    - name: OPENAI_API_KEY
      required: true
      description: "LLM API 호출에 필요"
    - name: SLACK_WEBHOOK_URL
      required: false
      description: "알림 전송 (선택)"
  cli:
    - name: playwright
      install: "npx playwright install"
      required: true
  npm:
    - name: sharp
      required: true
  mcp:
    - name: supabase
      package: "@supabase/mcp-server"
      required: false
      config:
        command: "npx"
        args: ["-y", "@supabase/mcp-server"]
      env: [SUPABASE_URL, SUPABASE_SECRET_KEY]
  runtime:
    node: ">=18"
  permissions:
    - filesystem
    - network
  teams:
    - @alice/doc-writer
\`\`\`

### Step 3. 최종 확인 & 배포

#### 3-1. 메타데이터 생성 (자동)
- description: skills 내용 기반으로 자동 생성합니다.
- long_description: 팀 소개 마크다운을 자동 생성합니다 (README.md가 있으면 활용).
- tags: 팀 특성에 맞는 태그를 추천합니다.

#### 3-2. 배포 요약 + 최종 확인
배포할 내용을 요약 표시합니다:

\`\`\`
배포 요약

팀: my-team v1.0.0
공개: Space 공개
Skills: 3개, Commands: 5개
requires: env 2개, cli 1개
\`\`\`

**AskUserQuestion 호출:**
- question: "이대로 배포할까요?"
- options: \`["배포", "취소"]\`

**응답 처리:**
- "배포" → \`relay publish --json\` 실행 (슬래시 커맨드에서 이미 버전/visibility를 relay.yaml에 저장했으므로 --json으로 인터랙티브 프롬프트 생략)
- "취소" → 중단

#### 3-3. 배포 완료 & 온보딩 가이드
- 배포 결과와 Space URL을 보여줍니다.
- \`relay publish\` 출력 끝에 코드블록 형태의 온보딩 가이드가 포함됩니다.
- 이 코드블록을 사용자에게 그대로 보여줍니다.
- 출력에 코드블록이 없으면 아래 형태로 직접 생성합니다:

\\\`\\\`\\\`
아래 가이드를 읽고 그대로 따라해줘:
https://relayax.com/api/registry/{owner}/{slug}/guide.md
\\\`\\\`\\\`

- \`{owner}\`과 \`{slug}\`는 배포된 팀의 실제 슬러그에서 추출합니다 (\`@owner/slug\` → \`owner\`, \`slug\`).
- "이 블록을 팀원에게 공유하면 Claude가 환경 체크부터 설치까지 자동으로 해줍니다"라고 안내합니다.
- CLI가 이미 설치된 사용자를 위한 짧은 버전도 함께 표시: \`/relay:relay-install <slug>\`
${BUSINESS_CARD_FORMAT}

## 예시

사용자: /relay-publish
→ 인증 확인 ✓, 팀 구조 분석 (skills 3개, commands 5개)
→ AskUserQuestion: "어디에 배포할까요?" → ["공개 (Space 공개)", "비공개 (Space 전용)"]
→ "공개" 선택
→ 보안 스캔 ✓ 시크릿 없음 → requires 분석 결과 표시
→ AskUserQuestion: "requires 설정이 맞나요?" → ["확인", "수정"]
→ "확인"
→ 배포 요약 표시
→ AskUserQuestion: "이대로 배포할까요?" → ["배포", "취소"]
→ "배포" → relay publish 실행
→ "배포 완료! URL: https://relayax.com/@my-space/my-team"
→ 온보딩 가이드 코드블록 표시
${ERROR_HANDLING_GUIDE}`,
  },
]

// ─── Builder Commands (로컬 설치) ───
// relay-publish가 글로벌로 승격되어 현재 비어있음.
// relay init --auto만 실행하면 모든 커맨드가 한번에 업데이트됨.

export const BUILDER_COMMANDS: CommandContent[] = []
