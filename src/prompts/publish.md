현재 디렉토리의 에이전트(.relay/)를 분석하고, 보안 점검 및 requirements를 구성한 뒤, 사용가이드를 생성하고 relay에 배포합니다.

## 사전 준비

### 0-1. 인증 확인

- `relay status --json` 명령어를 실행하여 로그인 상태를 확인합니다.
- 인증되어 있으면 다음 단계로 진행합니다.
- 미인증이면 바로 로그인을 진행합니다:
  1. `relay login` 실행 (timeout 300초)
     - 브라우저가 자동으로 열리고, 사용자가 로그인을 완료하면 토큰이 자동 저장됩니다.
  2. 완료 후 `relay status --json`으로 로그인 성공을 확인합니다.

### 0-2. 소스 패키징 (source → .relay/)

`relay package` CLI 명령을 사용하여 소스 디렉토리의 콘텐츠를 .relay/로 동기화합니다.
소스 탐색과 파일 비교는 CLI가 결정적으로 처리하고, 에이전트는 결과를 사용자에게 보여주고 흐름을 조율합니다.

#### A. 최초 배포 (.relay/relay.yaml이 없음)

##### 1단계: 소스 탐색

`relay package --init --json` 실행
- CLI가 프로젝트에서 에이전트 CLI 디렉토리(.claude/, .codex/, .gemini/ 등)를 자동 탐색합니다.
- 동시에 글로벌 스킬 디렉토리(~/.claude/skills/, ~/.codex/skills/ 등)도 스캔합니다.
- JSON 결과에 로컬 detected와 글로벌 스킬이 모두 포함됩니다:
  ```json
  {
    "status": "init_required",
    "detected": [
      { "source": ".claude", "name": "Claude Code", "summary": { "skills": 2, "commands": 3 }, "fileCount": 8 },
      { "source": ".codex", "name": "Codex", "summary": { "agents": 1 }, "fileCount": 2 }
    ],
    "global_skills": [
      { "path": "~/.claude/skills/code-review", "name": "code-review", "description": "코드 리뷰 자동화" },
      { "path": "~/.claude/skills/qa-testing", "name": "qa-testing", "description": "QA 테스트 실행" }
    ]
  }
  ```

- 아래 4가지 케이스로 분기합니다:

| 로컬 detected | 글로벌 스킬 | 동작 |
|---|---|---|
| 있음 | 있음 | 로컬 소스 선택 후, 글로벌 스킬 임포트 여부를 추가로 질문 (1-b단계) |
| 있음 | 없음 | 기존 플로우 그대로 (1-b단계 건너뜀) |
| 없음 | 있음 | "프로젝트에 에이전트 콘텐츠가 없지만, 글로벌 스킬 N개를 발견했습니다" → 다중선택 (1-b단계) |
| 없음 | 없음 | "배포 가능한 에이전트 콘텐츠가 없습니다. skills/이나 commands/를 먼저 만들어주세요." 안내 후 중단 |

##### 1-b단계: 글로벌 스킬 임포트 (global_skills가 있을 때만)

글로벌 스킬의 SKILL.md 파일 **내용을 직접 읽어** 각 스킬이 무엇을 하는지 파악한 후, 사용자에게 다중선택을 제안합니다.

**로컬 콘텐츠가 있을 때:**

**AskUserQuestion 호출:**
- question: "글로벌 스킬도 함께 배포할까요?"
- options: 각 스킬을 기능 설명과 함께 나열 + "건너뛰기"
- 예: `["code-review — 코드 리뷰 자동화", "qa-testing — QA 테스트 실행", "건너뛰기"]`
- 여러 개 선택 가능하도록 안내합니다. 사용자가 쉼표로 구분하거나 여러 번 응답할 수 있습니다.

**로컬 콘텐츠가 없을 때 (글로벌 스킬만 있는 경우):**

**AskUserQuestion 호출:**
- question: "프로젝트에 에이전트 콘텐츠가 없지만, 글로벌 스킬 N개를 발견했습니다. 배포할 스킬을 선택하세요"
- options: 각 스킬을 기능 설명과 함께 나열 + "취소"
- 최소 1개 이상 선택해야 진행 가능합니다.

**선택된 글로벌 스킬 처리:**
- 선택된 스킬을 `.relay/skills/<스킬명>/`으로 복사합니다.
- 복사 후에는 `.relay/` 내에서 독립 관리됩니다 (글로벌 원본과의 링크 없음).
- 재배포 시 글로벌 스킬을 다시 스캔하지 않습니다. 이미 `.relay/`에 복사된 콘텐츠를 기준으로 동작합니다.
- relay.yaml의 `source` 필드는 로컬 소스 디렉토리만 추적합니다. 글로벌에서 임포트한 스킬은 source 추적 대상이 아닙니다.

##### 2단계: 콘텐츠 분석 & 에이전트 포지셔닝

detected된 소스 디렉토리의 skills/, commands/, agents/, rules/ 파일과 **임포트된 글로벌 스킬의 내용을 직접 읽어** 에이전트의 정체성을 파악합니다.

**분석 관점:**
- 이 에이전트가 **무엇을 하는 에이전트**인지 (코드 리뷰? QA? 문서 생성? 데이터 분석?)
- 어떤 **기술 스택/도메인**에 특화되어 있는지 (Supabase? React? Python?)
- 설치자에게 **어떤 가치**를 제공하는지

이 분석을 기반으로 에이전트를 하나의 "제품"으로 포지셔닝합니다.

**중요: 소스 디렉토리 이름(.claude 등)이나 글로벌/로컬 구분은 인프라 디테일이므로 사용자에게 노출하지 않습니다.**
사용자에게는 에이전트의 기능과 정체성 중심으로 질문합니다.

##### 3단계: 배포 제안

분석 결과를 바탕으로 에이전트 배포를 제안합니다.

**detected가 1개일 때:**

**AskUserQuestion 호출:**
- question: 콘텐츠 분석 기반의 포지셔닝 질문
- 예시:
  - "Supabase 웹 개발 에이전트로 배포할까요? (skills 2개, commands 3개)"
  - "코드 리뷰 자동화 에이전트로 배포할까요? (skills 1개, agents 2개)"
  - "Next.js QA 테스트 에이전트로 배포할까요? (commands 5개)"
- options: `["배포", "취소"]`

**detected가 여러 개일 때:**
각 소스의 콘텐츠를 분석하여 서로 다른 에이전트로 포지셔닝합니다.

**AskUserQuestion 호출:**
- question: "어떤 에이전트로 배포할까요?"
- options: 콘텐츠 기반 설명 (예: `["Supabase 웹 개발 에이전트 (skills 2개, commands 3개)", "QA 자동화 에이전트 (agents 1개)"]`)
- 디렉토리 이름은 내부적으로만 매핑하고, 사용자에게는 에이전트의 기능으로 보여줍니다.

**글로벌 스킬만으로 구성된 경우 (로컬 detected 없음):**
임포트된 스킬들의 내용을 분석하여 에이전트 포지셔닝을 자동 생성합니다. 별도의 소스 선택 없이 바로 4단계로 진행합니다.

##### 4단계: 에이전트 정보 확정

포지셔닝 분석을 기반으로 에이전트 이름과 설명을 제안합니다.

**이름(name)과 slug는 별개입니다:**
- **이름(name)**: 마켓플레이스에 표시되는 이름. 한국어 등 자유로운 문자 사용 가능 (예: "콘텐츠 에이전트", "Supabase 웹 개발")
- **slug**: URL과 `relay install`에 사용되는 식별자. 영문 소문자, 숫자, 하이픈만 가능 (예: "content-agent", "supabase-web-dev")

**AskUserQuestion 호출:**
- question: "에이전트 이름을 확인해주세요 (한국어 가능)"
- 분석된 포지셔닝에서 자연스러운 에이전트 이름을 제안합니다 (예: "콘텐츠 에이전트", "Supabase 웹 개발")
- 현재 디렉토리명이 아닌, **콘텐츠 기반** 이름을 기본값으로 제시합니다.

**한국어 이름은 자동으로 로마자 slug가 생성됩니다.** 자동 생성된 slug를 확인합니다:

**AskUserQuestion 호출:**
- question: "Slug를 확인해주세요 (URL/설치용 영문 식별자)"
- 한국어 이름은 로마자 변환 slug를 기본값으로 제시합니다 (예: "콘텐츠 에이전트" → "kontencheu-eijenteu").
- 로마자 변환이 길거나 부자연스러우면 콘텐츠 기반 영문 slug를 대안으로 제안합니다 (예: "content-agent").
- 영문 이름이면 자동 slug를 그대로 사용하고 이 단계를 건너뜁니다.

**AskUserQuestion 호출:**
- question: "에이전트 설명을 확인해주세요 (마켓플레이스에 표시됩니다)"
- 분석한 콘텐츠를 기반으로 설치자 관점의 설명을 제안합니다.
- 좋은 예: "Supabase 기반 웹앱의 DB 마이그레이션, API 개발, 테스트를 자동화합니다"
- 나쁜 예: ".claude 디렉토리의 skills와 commands를 패키징한 에이전트"

##### 5단계: 초기화 & 패키징

자동 처리:
- `.relay/relay.yaml` 생성:
  ```yaml
  name: <확정된 이름>  # 한국어 가능 (예: "콘텐츠 에이전트")
  slug: <확정된 slug>  # 영문만 (예: "content-agent")
  description: <확정된 설명>
  source: <선택된 소스 디렉토리> # 예: .claude (내부용, 로컬 소스가 있을 때만)
  version: 1.0.0
  tags: []
  ```
- 로컬 소스가 있으면: `relay package --source <선택된 소스> --sync --json` 실행하여 콘텐츠를 .relay/로 복사
- 글로벌 스킬만으로 구성된 경우: 1-b단계에서 이미 `.relay/skills/`로 복사 완료. source 필드는 생략하고, relay.yaml에 패키징 동기화 대상 없이 `.relay/` 직접 편집 모드로 동작합니다.
- `relay init --auto` 실행하여 글로벌 커맨드 설치 보장
- 결과를 사용자에게 표시

#### B. 재배포 (.relay/relay.yaml이 있음)

1. `relay package --json` 실행
   - CLI가 relay.yaml의 `source` 필드를 읽고, 소스 디렉토리와 .relay/를 파일 해시로 비교합니다.
   - JSON 결과 예시:
     ```json
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
     ```

2. **변경이 있으면** (added + modified + deleted > 0) → diff를 사용자에게 보여줍니다:
   ```
   소스 동기화 (.claude/ → .relay/)
     변경: skills/code-review/SKILL.md
     신규: commands/deploy.md
     삭제: commands/old-cmd.md
     유지: 5개 파일
   ```

   **AskUserQuestion 호출:**
   - question: "소스 변경사항을 .relay/에 반영할까요?"
   - options: `["반영", "변경 확인", "건너뛰기"]`

   **응답 처리:**
   - "반영" → `relay package --sync --json` 실행하여 동기화
   - "변경 확인" → 변경된 파일의 내용을 직접 읽어 diff를 상세히 보여준 후 다시 AskUserQuestion
   - "건너뛰기" → 현재 .relay/ 그대로 배포

3. **변경이 없으면** → "✓ 소스와 동기화 상태입니다." 표시 후 다음 단계로

4. `source` 필드가 없으면 → .relay/ 내 콘텐츠를 직접 편집하는 모드로 간주하고 동기화를 건너뜁니다.

## 인터랙션 플로우

이 커맨드는 4단계 인터랙션으로 진행됩니다. 각 단계에서 반드시 AskUserQuestion 도구를 사용하세요.

### Step 1. 버전 범프

relay.yaml의 현재 `version`을 읽고 semver 범프를 제안합니다.

**AskUserQuestion 호출:**
- question: "버전을 올릴까요? (현재 v{version})"
- options: `["v{patch} — patch (버그 수정)", "v{minor} — minor (기능 추가)", "v{major} — major (큰 변경)", "v{version} — 유지"]`

예시: 현재 v1.0.0이면 → `["v1.0.1 — patch", "v1.1.0 — minor", "v2.0.0 — major", "v1.0.0 — 유지"]`

**응답 처리:**
- 유지 외 선택 → relay.yaml의 version을 선택된 값으로 업데이트
- 유지 → 그대로 진행

### Step 1. 공개 범위 선택

relay.yaml의 `visibility` 설정을 확인합니다.

#### 신규 배포 (visibility 미설정)

**AskUserQuestion 호출:**
- question: "공개 범위를 선택하세요"
- options: `["공개 — 누구나 설치", "링크 공유 — 접근 링크가 있는 사람만 설치", "비공개 — Org 멤버만"]`

**응답 처리:**
- "공개" → relay.yaml에 `visibility: public` 저장
- "링크 공유" → relay.yaml에 `visibility: private` 저장. 배포 후 웹 대시보드(/dashboard)에서 접근 링크를 생성하고 구매 안내를 설정할 수 있다고 안내.
- "비공개" → `relay orgs list --json` 실행 후 Organization 목록 표시
  - Org가 0개이면: "비공개 배포하려면 Organization이 필요합니다. www.relayax.com/orgs 에서 Organization을 생성하세요."라고 안내하고 중단합니다.

  **AskUserQuestion 호출 (Org가 1개여도 반드시 호출):**
  - question: "어떤 Organization에 배포할까요?"
  - options: `["<org1_name>", "<org2_name>", ...]`
  - **중요: Org가 1개라도 자동 선택하지 말고 반드시 사용자에게 확인받으세요.**

  → relay.yaml에 `visibility: internal`, `org: <selected_slug>` 저장

#### 재배포 (visibility 이미 설정됨)

현재 설정을 확인합니다:

**AskUserQuestion 호출:**
- question: 공개일 때 "현재 **공개** 설정입니다. 유지할까요?", 링크공유일 때 "현재 **링크 공유** 설정입니다. 접근 링크가 있는 사람만 설치 가능합니다. 유지할까요?", 비공개일 때 "현재 **비공개** 설정입니다 (Org: {name}). 유지할까요?"
- options: `["유지", "변경"]`

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
- **env**: 환경변수 참조 (process.env.*, ${VAR}, os.environ 등)
- **cli**: 참조하는 CLI 도구 (playwright, ffmpeg, sharp 등)
- **npm**: import/require되는 npm 패키지
- **mcp**: MCP 서버 설정
- **runtime**: Node.js/Python 등 최소 버전
- **agents**: 의존하는 다른 relay 에이전트

분석 결과를 요약 표시합니다:

```
requires 분석 결과

환경변수:
  OPENAI_API_KEY — 필수 (LLM API 호출)
  SLACK_WEBHOOK_URL — 선택 (알림 전송)

CLI: playwright (필수)
npm: sharp (필수)
MCP: supabase (선택)
```

**AskUserQuestion 호출:**
- question: "requires 설정이 맞나요?"
- options: `["확인", "수정"]`

**응답 처리:**
- "확인" → .relay/relay.yaml에 requires 섹션 저장, 다음 단계로
- "수정" → 사용자와 텍스트 대화로 수정 후 다시 확인

```yaml
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
  agents:
    - @alice/doc-writer
```

### Step 3. 최종 확인 & 배포

#### 3-1. 메타데이터 생성 (자동)
- description: skills 내용 기반으로 자동 생성합니다.
- long_description: 에이전트 소개 마크다운을 자동 생성합니다 (README.md가 있으면 활용).
- tags: 에이전트 특성에 맞는 태그를 추천합니다.

#### 3-2. 배포 요약 + 최종 확인
배포할 내용을 요약 표시합니다:

```
배포 요약

에이전트: my-agent v1.0.0
공개: 공개
Skills: 3개, Commands: 5개
requires: env 2개, cli 1개
```

**AskUserQuestion 호출:**
- question: "이대로 배포할까요?"
- options: `["배포", "취소"]`

**응답 처리:**
- "배포" → `relay publish --json` 실행 (슬래시 커맨드에서 이미 버전/visibility를 relay.yaml에 저장했으므로 --json으로 인터랙티브 프롬프트 생략)
- "취소" → 중단

#### 3-3. 배포 완료 & 온보딩 가이드
- 배포 결과와 에이전트 URL을 보여줍니다.
- `relay publish` 출력 끝에 코드블록 형태의 온보딩 가이드가 포함됩니다.
- 이 코드블록을 사용자에게 그대로 보여줍니다.
- 출력에 코드블록이 없으면 아래 형태로 직접 생성합니다:
- `relay publish --json` 응답의 `access_code` 필드가 있으면 (internal agent) 가이드 URL에 `?code={access_code}` 포함:

\`\`\`
아래 가이드를 읽고 그대로 따라해줘:
https://relayax.com/api/registry/{owner}/{slug}/guide.md?code={access_code}
\`\`\`

- `access_code`가 없으면 (public agent) code 파라미터 없이:

\`\`\`
아래 가이드를 읽고 그대로 따라해줘:
https://relayax.com/api/registry/{owner}/{slug}/guide.md
\`\`\`

- private agent의 경우:
  - "접근 코드를 생성할까요?" 사용자 확인 → `relay grant create --agent {slug}` 실행 → 생성된 코드로 `guide.md?code={agent_code}` 표시
  - 이미 접근 코드가 있으면 기존 코드 사용 가능

**접근 코드 영향범위 안내** (visibility별로 publish 후 표시):
- **public**: 접근 코드 불필요. 누구나 설치 가능.
- **internal**: org 접근 코드 사용. 코드를 사용하면 Organization 멤버로 가입되며, 해당 org의 **모든 internal 에이전트**에 접근 가능.
- **private (org)**: agent 접근 코드 사용. 코드를 사용하면 **이 에이전트에만** 접근 가능 + org 자동 가입.
- **private (personal)**: agent 접근 코드 사용. 코드를 사용하면 **이 에이전트에만** 접근 가능.
- `{owner}`과 `{slug}`는 배포된 에이전트의 실제 슬러그에서 추출합니다 (`@owner/slug` → `owner`, `slug`).
- "이 블록을 동료에게 공유하면 Claude가 환경 체크부터 설치까지 자동으로 해줍니다"라고 안내합니다.
- CLI가 이미 설치된 사용자를 위한 짧은 버전도 함께 표시: `/relay:relay-install <slug>`
{{BUSINESS_CARD_FORMAT}}

## 예시

사용자: /relay-publish
→ 인증 확인 ✓, 에이전트 구조 분석 (skills 3개, commands 5개)
→ AskUserQuestion: "어디에 배포할까요?" → ["공개", "링크 공유", "비공개 (Org 전용)"]
→ "공개" 선택
→ 보안 스캔 ✓ 시크릿 없음 → requires 분석 결과 표시
→ AskUserQuestion: "requires 설정이 맞나요?" → ["확인", "수정"]
→ "확인"
→ 배포 요약 표시
→ AskUserQuestion: "이대로 배포할까요?" → ["배포", "취소"]
→ "배포" → relay publish 실행
→ "배포 완료! URL: https://relayax.com/@my-org/my-agent"
→ 온보딩 가이드 코드블록 표시
{{ERROR_HANDLING_GUIDE}}
