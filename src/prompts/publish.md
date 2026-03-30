현재 디렉토리의 에이전트(.relay/)를 분석하고, 보안 점검 및 requirements를 구성한 뒤, 사용가이드를 생성하고 relay에 배포합니다.

> **에이전트 호환성**: 이 프롬프트는 다양한 AI 에이전트에서 실행됩니다.
> 사용자에게 질문할 때는 사용 가능한 사용자 질문 도구를 호출하세요 (AskUserQuestion, ask_user, AskQuestion 등).
> 반드시 도구를 호출하여 응답을 기다려야 합니다. 텍스트로만 질문하고 세션을 종료하면 안 됩니다.

## 사전 준비

### 0-1. 인증 확인

- `relay status --json` 명령어를 실행하여 로그인 상태를 확인합니다.
- 인증되어 있으면 다음 단계로 진행합니다.
- 미인증이면 바로 로그인을 진행합니다:
  1. `relay login` 실행 (timeout 300초)
     - 브라우저가 자동으로 열리고, 사용자가 로그인을 완료하면 토큰이 자동 저장됩니다.
  2. 완료 후 `relay status --json`으로 로그인 성공을 확인합니다.

### 0-2. 소스 패키징 (콘텐츠 선택 → .relay/)

`relay package` CLI 명령을 사용하여 소스의 콘텐츠를 .relay/로 동기화합니다.
소스 탐색과 파일 비교는 CLI가 결정적으로 처리하고, 에이전트는 결과를 사용자에게 보여주고 흐름을 조율합니다.

**핵심 원칙:**
- `.relay/`는 배포 산출물이지, 작업 공간이 아닙니다. 사용자의 작업 공간은 소스 디렉토리(로컬/글로벌)입니다.
- 로컬 소스와 글로벌 소스를 동일하게 취급합니다. 구분은 내부 경로로만 처리합니다.
- 소스 디렉토리 통째가 아닌 개별 스킬/에이전트를 체리픽하여 패키지에 포함합니다.
- relay.yaml의 `contents[]` 매니페스트로 "뭘 어디서 가져왔나"를 추적합니다.

#### A. 최초 배포 (.relay/relay.yaml이 없음)

**환경 B (MCP)의 경우:**
`relay_package` MCP tool (`mode: "init"`)을 사용합니다. CLI의 `relay package --init --json`과 동일한 결과를 반환합니다.
- 결과의 `sources[]`는 배포할 콘텐츠 **후보** 목록입니다. 전부 배포 대상이 아닙니다.
- 사용자에게 어떤 콘텐츠를 패키지에 포함할지 반드시 물어보세요.

**환경 A (터미널)의 경우:**

##### 1단계: 소스 탐색

`relay package --init --json` 실행
- CLI가 프로젝트 로컬(.claude/, .codex/ 등)과 글로벌 홈(~/.claude/, ~/.codex/ 등)을 모두 스캔합니다.
- 각 소스의 skills/, agents/, commands/, rules/ 내 개별 항목 목록을 반환합니다.
- 동시에 `~/.relay/agents/`에 기존 글로벌 에이전트 패키지가 있는지도 확인합니다.
- JSON 결과:
  ```json
  {
    "status": "init_required",
    "sources": [
      {
        "path": ".claude",
        "location": "local",
        "name": "Claude Code",
        "items": [
          { "name": "code-review", "type": "skill", "relativePath": "skills/code-review" },
          { "name": "deploy", "type": "command", "relativePath": "commands/deploy.md" }
        ]
      },
      {
        "path": "~/.claude",
        "location": "global",
        "name": "Claude Code (global)",
        "items": [
          { "name": "qa-testing", "type": "skill", "relativePath": "skills/qa-testing" },
          { "name": "dev-lead", "type": "agent", "relativePath": "agents/dev-lead.md" }
        ]
      }
    ],
    "existing_agents": []
  }
  ```

- 아래 케이스로 분기합니다:

| sources | existing_agents | 동작 |
|---|---|---|
| 항목 있음 | 없음 | 콘텐츠 선택 → 패키징 (1-b단계) |
| 항목 있음 | 있음 | 기존 에이전트 재배포 또는 새 에이전트 생성 선택 |
| 항목 없음 | 있음 | 기존 에이전트 재배포 선택 |
| 항목 없음 | 없음 | "배포 가능한 에이전트 콘텐츠가 없습니다." 안내 후 중단 |

**기존 글로벌 에이전트가 있을 때:**

**사용자 질문 도구 호출:**
- question: "기존 에이전트를 발견했습니다. 어떤 작업을 할까요?"
- options: `["<name> (v<version>) — 재배포", ..., "새 에이전트 만들기"]`
- 재배포 선택 시 → B. 재배포 플로우로 이동 (해당 에이전트의 relay.yaml 경로 사용)
- 새 에이전트 선택 시 → 아래 1-b단계로 진행

##### 1-b단계: 콘텐츠 선택

`sources[]`의 모든 항목을 사용자에게 표시하고, 패키지에 포함할 콘텐츠를 선택받습니다.
각 항목의 SKILL.md, 에이전트 파일 등의 **내용을 직접 읽어** 기능을 파악한 후 설명과 함께 표시합니다.

**사용자 질문 도구 호출:**
- question: "배포할 콘텐츠를 선택하세요"
- options: 모든 소스의 항목을 기능 설명과 함께 나열
- 예: `["code-review — 코드 리뷰 자동화 (로컬)", "qa-testing — QA 테스트 (글로벌)", "dev-lead — 개발 리드 에이전트 (글로벌)", "전체 선택"]`
- **중요:** 소스 경로(.claude 등)는 내부적으로만 추적합니다. 사용자에게는 기능 설명으로 보여줍니다. 로컬/글로벌 구분은 참고용으로만 표시합니다.

**에이전트 의존성 분석:**
- 사용자가 에이전트를 선택하면, 해당 에이전트 파일의 **내용을 직접 읽어** 참조하는 스킬을 파악합니다.
- 슬래시 커맨드 참조, 스킬 이름 언급, "~를 사용" 패턴 등을 탐색합니다.
- 의존 스킬이 sources에 존재하면: "dev-lead가 code-review, qa-testing을 참조합니다. 함께 포함합니다."라고 안내하고 자동 포함 대상으로 표시합니다.
- 의존 스킬이 sources에 없으면: "dev-lead가 참조하는 missing-skill을 찾을 수 없습니다"라고 경고합니다.
- 사용자가 자동 포함을 거부하면 해당 스킬은 제외합니다.

##### 2단계: 콘텐츠 분석 & 에이전트 포지셔닝

선택된 콘텐츠의 내용을 직접 읽어 에이전트의 정체성을 파악합니다.

**분석 관점:**
- 이 에이전트가 **무엇을 하는 에이전트**인지 (코드 리뷰? QA? 문서 생성? 데이터 분석?)
- 어떤 **기술 스택/도메인**에 특화되어 있는지 (Supabase? React? Python?)
- 설치자에게 **어떤 가치**를 제공하는지

이 분석을 기반으로 에이전트를 하나의 "제품"으로 포지셔닝합니다.

**중요: 소스 디렉토리 이름(.claude 등)이나 글로벌/로컬 구분은 인프라 디테일이므로 사용자에게 노출하지 않습니다.**
사용자에게는 에이전트의 기능과 정체성 중심으로 질문합니다.

##### 3단계: 에이전트 정보 확정

포지셔닝 분석을 기반으로 에이전트 이름과 설명을 제안합니다.

**이름(name)과 slug는 별개입니다:**
- **이름(name)**: 마켓플레이스에 표시되는 이름. 한국어 등 자유로운 문자 사용 가능 (예: "콘텐츠 에이전트", "Supabase 웹 개발")
- **slug**: URL과 `relay install`에 사용되는 식별자. 영문 소문자, 숫자, 하이픈만 가능 (예: "content-agent", "supabase-web-dev")

**사용자 질문 도구 호출:**
- question: "에이전트 이름을 확인해주세요 (한국어 가능)"
- 분석된 포지셔닝에서 자연스러운 에이전트 이름을 제안합니다 (예: "콘텐츠 에이전트", "Supabase 웹 개발")
- 현재 디렉토리명이 아닌, **콘텐츠 기반** 이름을 기본값으로 제시합니다.

**한국어 이름은 자동으로 로마자 slug가 생성됩니다.** 자동 생성된 slug를 확인합니다:

**사용자 질문 도구 호출:**
- question: "Slug를 확인해주세요 (URL/설치용 영문 식별자)"
- 한국어 이름은 로마자 변환 slug를 기본값으로 제시합니다 (예: "콘텐츠 에이전트" → "kontencheu-eijenteu").
- 로마자 변환이 길거나 부자연스러우면 콘텐츠 기반 영문 slug를 대안으로 제안합니다 (예: "content-agent").
- 영문 이름이면 자동 slug를 그대로 사용하고 이 단계를 건너뜁니다.

**사용자 질문 도구 호출:**
- question: "에이전트 설명을 확인해주세요 (마켓플레이스에 표시됩니다)"
- 분석한 콘텐츠를 기반으로 설치자 관점의 설명을 제안합니다.
- 좋은 예: "Supabase 기반 웹앱의 DB 마이그레이션, API 개발, 테스트를 자동화합니다"
- 나쁜 예: ".claude 디렉토리의 skills와 commands를 패키징한 에이전트"

##### 4단계: 초기화 & 패키징

자동 처리:

**패키지 홈 결정:**
- 프로젝트 디렉토리에 `.relay/`가 있거나 만들 수 있으면 → 프로젝트 `.relay/` 사용
- 프로젝트 디렉토리가 없으면 (데스크톱앱 등) → `~/.relay/agents/<slug>/` 에 생성

**relay.yaml 생성:**
```yaml
name: <확정된 이름>  # 한국어 가능
slug: <확정된 slug>  # 영문만
description: <확정된 설명>
version: 1.0.0
tags: []
contents:
  - name: code-review
    type: skill
    from: .claude/skills/code-review
  - name: qa-testing
    type: skill
    from: ~/.claude/skills/qa-testing
  - name: dev-lead
    type: agent
    from: ~/.claude/agents/dev-lead.md
```

- 선택된 각 콘텐츠의 `from` 경로: 로컬이면 상대 경로 (`.claude/skills/...`), 글로벌이면 `~/` 접두사 (`~/.claude/skills/...`)
- `relay package --sync --json` 실행하여 선택된 콘텐츠를 .relay/로 복사
- `relay init --auto` 실행하여 글로벌 커맨드 설치 보장
- 결과를 사용자에게 표시

#### B. 재배포 (.relay/relay.yaml이 있음)

**환경 B (MCP)의 경우:**
`relay_package` MCP tool을 사용합니다:
- `mode: "migrate"` — B-0 마이그레이션 (source → contents)
- `mode: "sync"` — B-1~B-2 동기화 + 변경 반영
- sync 결과의 `new_items`가 있으면 B-3 새 콘텐츠 추가도 진행합니다.

**환경 A (터미널)의 경우:**

##### B-0. 기존 source 필드 마이그레이션

relay.yaml에 기존 `source` 필드만 있고 `contents`가 없으면:
1. "기존 source 형식을 새로운 contents 형식으로 마이그레이션합니다."라고 안내
2. `relay package --migrate --json` 실행
3. 마이그레이션 결과를 사용자에게 보여줌
4. 이후 정상 재배포 플로우로 진행

##### B-1. 콘텐츠 동기화

`relay package --json` 실행
- CLI가 relay.yaml의 `contents[]` 매니페스트를 읽고, 각 항목의 원본(from 경로)과 .relay/ 내 복사본을 파일 해시로 비교합니다.
- 동시에 소스 디렉토리를 다시 스캔하여 새로 추가된 항목도 탐지합니다.
- JSON 결과:
  ```json
  {
    "diff": [
      { "name": "code-review", "type": "skill", "status": "modified", "files": [...] },
      { "name": "qa-testing", "type": "skill", "status": "unchanged" }
    ],
    "new_items": [
      { "name": "new-skill", "type": "skill", "source": "~/.claude", "relativePath": "skills/new-skill" }
    ],
    "synced": false,
    "summary": { "modified": 1, "unchanged": 1, "source_missing": 0, "new_available": 1 }
  }
  ```

##### B-2. 변경 사항 처리

**변경이 있으면** (modified > 0):

변경된 항목을 표시합니다:
```
콘텐츠 동기화 상태
  변경: code-review (skill)
    modified: SKILL.md
  유지: qa-testing (skill)
```

**사용자 질문 도구 호출:**
- question: "변경된 콘텐츠를 반영할까요?"
- options: `["반영", "변경 확인", "건너뛰기"]`

**응답 처리:**
- "반영" → `relay package --sync --json` 실행하여 동기화
- "변경 확인" → 변경된 파일의 내용을 직접 읽어 diff를 상세히 보여준 후 다시 사용자 질문 도구 호출
- "건너뛰기" → 현재 .relay/ 그대로 배포

**변경이 없으면** → "✓ 모든 콘텐츠가 동기화 상태입니다." 표시 후 다음 단계로

**source_missing인 항목이 있으면:**
- "⚠ code-review의 원본(~/.claude/skills/code-review)을 찾을 수 없습니다. .relay/ 내 복사본을 사용합니다."라고 안내

##### B-3. 새 콘텐츠 추가

**new_items가 있으면:**

새로 발견된 항목의 파일 내용을 직접 읽어 기능을 파악한 후 표시합니다:

**사용자 질문 도구 호출:**
- question: "새로 발견된 콘텐츠가 있습니다. 패키지에 추가할까요?"
- options: 각 항목을 기능 설명과 함께 나열 + "건너뛰기"
- 예: `["new-skill — 새 유틸리티 스킬", "건너뛰기"]`

추가 선택 시:
- 해당 항목을 relay.yaml의 `contents[]`에 추가
- .relay/로 복사

**new_items가 없으면** → 이 단계 건너뜀

**contents가 없으면** (contents 필드가 빈 배열) → .relay/ 내 콘텐츠를 직접 편집하는 모드로 간주하고 동기화를 건너뜁니다.

## 인터랙션 플로우

이 커맨드는 4단계 인터랙션으로 진행됩니다. 각 단계에서 반드시 사용자 질문 도구를 호출하세요.

### Step 1. 버전 범프

relay.yaml의 현재 `version`을 읽고 semver 범프를 제안합니다.

**사용자 질문 도구 호출:**
- question: "버전을 올릴까요? (현재 v{version})"
- options: `["v{patch} — patch (버그 수정)", "v{minor} — minor (기능 추가)", "v{major} — major (큰 변경)", "v{version} — 유지"]`

예시: 현재 v1.0.0이면 → `["v1.0.1 — patch", "v1.1.0 — minor", "v2.0.0 — major", "v1.0.0 — 유지"]`

**응답 처리:**
- 유지 외 선택 → relay.yaml의 version을 선택된 값으로 업데이트
- 유지 → 그대로 진행

### Step 1. Organization 선택 & 공개 범위 설정

#### 1-1. Organization 확인 (먼저 실행)

Organization 목록을 조회합니다:
- 환경 A: `relay orgs list --json` 실행
- 환경 B: `relay_org_list` MCP tool 호출

**Org가 0개이면:**
- **사용자 질문 도구 호출:**
  - question: "Organization이 없습니다. 비공개 배포를 하려면 Organization이 필요합니다. Organization을 만들까요?"
  - options: `["Organization 생성", "Organization 없이 계속 (공개/링크공유만 가능)"]`
- "Organization 생성" 선택 시:
  - 로그인 정보(username, email)를 기반으로 Organization 이름을 추천합니다:
    - 업무용 이메일(커스텀 도메인)이면 → 도메인에서 회사명 추출하여 추천. 예: `haemin@relayax.com` → "relayax"
    - 비업무용 이메일(gmail.com, naver.com, kakao.com, daum.net, hotmail.com, outlook.com, yahoo.com, icloud.com 등 무료 메일)이면 → username을 추천. 예: `haemin` → "haemin"
    - email이 없으면 → username을 추천
  - **사용자 질문 도구 호출:** question: "Organization 이름을 입력하세요. (추천: {추천이름})"
  - 환경 A: `relay orgs create "이름" --json` 실행
  - 환경 B: `relay_org_create` MCP tool 호출
  - 생성 후 org 목록을 갱신합니다.

**Org가 1개 이상이면:**

**사용자 질문 도구 호출 (Org가 1개여도 반드시 호출):**
- question: "어떤 Organization에 배포할까요?"
- options: `["<org1_name> (<org1_slug>)", "<org2_name> (<org2_slug>)", ..., "Organization 없이 배포 (공개/링크공유)"]`
- **중요: Org가 1개라도 자동 선택하지 말고 반드시 사용자에게 확인받으세요.**

**응답 처리:**
- Org 선택 → relay.yaml에 `org: <selected_slug>` 저장, 1-2단계로
- "Organization 없이 배포" → org 없이 1-2단계로 (비공개 옵션 제외)

#### 1-2. 공개 범위 선택

relay.yaml의 `visibility` 설정을 확인합니다.

**신규 배포 (visibility 미설정):**

Org가 선택된 경우:
- **사용자 질문 도구 호출:**
  - question: "{org_name} Organization에 배포합니다. 공개 범위를 선택하세요"
  - options: `["public — 외부인 포함 누구나 설치", "internal — 조직 구성원 누구나 설치", "private — 조직 내에서도 허가받은 사람만 설치"]`

Org가 없는 경우 (개인 배포):
- **사용자 질문 도구 호출:**
  - question: "공개 범위를 선택하세요"
  - options: `["public — 누구나 검색하여 설치 가능", "private — 접근 링크를 받은 사람만 설치 가능"]`

**응답 처리:**

- "public" → relay.yaml에 `visibility: public` 저장
- "internal" → relay.yaml에 `visibility: internal` 저장
- "private" → relay.yaml에 `visibility: private` 저장. 배포 후 웹 대시보드에서 접근 코드를 생성하여 공유할 수 있다고 안내.

**재배포 (visibility 이미 설정됨):**

**사용자 질문 도구 호출:**
- question: 공개일 때 "현재 **공개** 설정입니다. 유지할까요?", 링크공유일 때 "현재 **링크 공유** 설정입니다. 접근 링크가 있는 사람만 설치 가능합니다. 유지할까요?", 비공개일 때 "현재 **비공개** 설정입니다 (Org: {name}). 유지할까요?"
- options: `["유지", "변경"]`

"변경" → 1-1부터 다시 진행

### Step 2. 보안 점검 & requires 확인

.relay/ 내 모든 파일을 자동 분석합니다.

#### 2-1. 시크릿 & 개인정보 스캔 (자동)

**시크릿 스캔:**
- 하드코딩된 API 키, 토큰, 비밀번호, Private Key 등을 탐색합니다.
  - 예: sk-..., ghp_..., AKIA..., Bearer 토큰, JWT, -----BEGIN PRIVATE KEY----- 등
- 발견 시 **즉시 사용자에게 경고**하고, 환경변수로 대체하도록 안내합니다.
- 시크릿이 제거되지 않으면 배포를 진행하지 않습니다.

**개인정보 스캔:**
- 이메일 주소, 전화번호, 실명, 주소 등 개인정보가 포함된 파일을 탐색합니다.
- **중요: 패키지에 포함된 모든 파일은 설치한 사람이 볼 수 있습니다.** 상세페이지에 노출되지 않더라도 패키지 자체에 포함됩니다.
- 발견 시 사용자에게 경고하고 제거/수정 여부를 확인받습니다:
  - "⚠ {파일명}에 개인정보({종류})가 포함되어 있습니다. 이 파일은 패키지에 포함되어 설치한 사람이 볼 수 있습니다."
  - **사용자 질문 도구 호출:** question: "개인정보가 포함된 파일을 어떻게 처리할까요?", options: `["제거 후 배포", "그대로 배포", "취소"]`

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

**사용자 질문 도구 호출:**
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

**사용자 질문 도구 호출:**
- question: "이대로 배포할까요?"
- options: `["배포", "취소"]`

**응답 처리:**
- "배포":
  - 환경 A: `relay publish --json` 실행 (슬래시 커맨드에서 이미 버전/visibility를 relay.yaml에 저장했으므로 --json으로 인터랙티브 프롬프트 생략)
  - 환경 B: `relay_publish` MCP tool 호출 (`project_path`는 프로젝트 루트 경로)
- "취소" → 중단

#### 3-3. 배포 완료 & 온보딩 가이드
- 배포 결과와 에이전트 URL을 보여줍니다.
- `relay publish` 출력 끝에 코드블록 형태의 온보딩 가이드가 포함됩니다.
- 이 코드블록을 사용자에게 그대로 보여줍니다.
- 출력에 코드블록이 없으면 아래 형태로 직접 생성합니다:
- `relay publish --json` 응답의 `access_code` 필드가 있으면 (internal agent) 가이드 URL에 `?code={access_code}` 포함:

\`\`\`
{{GUIDE_INSTRUCTION}}
https://relayax.com/api/registry/{owner}/{slug}/guide.md?code={access_code}
\`\`\`

- `access_code`가 없으면 (public agent) code 파라미터 없이:

\`\`\`
{{GUIDE_INSTRUCTION}}
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
- "이 블록을 동료에게 공유하면 AI 에이전트가 환경 체크부터 설치까지 자동으로 해줍니다"라고 안내합니다.
- CLI가 이미 설치된 사용자를 위한 짧은 버전도 코드 블록으로 함께 표시: `/relay-install <slug>`

## 예시

사용자: /relay-publish
→ 인증 확인 ✓, 에이전트 구조 분석 (skills 3개, commands 5개)
→ 사용자 질문 도구: "어디에 배포할까요?" → ["공개", "링크 공유", "비공개 (Org 전용)"]
→ "공개" 선택
→ 보안 스캔 ✓ 시크릿 없음 → requires 분석 결과 표시
→ 사용자 질문 도구: "requires 설정이 맞나요?" → ["확인", "수정"]
→ "확인"
→ 배포 요약 표시
→ 사용자 질문 도구: "이대로 배포할까요?" → ["배포", "취소"]
→ "배포" → relay publish 실행
→ "배포 완료! URL: https://relayax.com/@my-org/my-agent"
→ 온보딩 가이드 코드블록 표시
{{ERROR_HANDLING_GUIDE}}
