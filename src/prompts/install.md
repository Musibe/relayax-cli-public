요청된 에이전트를 relay에서 다운로드하고, 현재 에이전트 환경에 맞게 구성합니다.
인자 없이 호출하면 인터랙티브 탐색 모드로 진입합니다.

> **에이전트 호환성**: 이 프롬프트는 다양한 AI 에이전트에서 실행됩니다.
> 사용자에게 질문할 때는 사용 가능한 사용자 질문 도구를 호출하세요 (AskUserQuestion, ask_user, AskQuestion 등).
> 반드시 도구를 호출하여 응답을 기다려야 합니다. 텍스트로만 질문하고 세션을 종료하면 안 됩니다.

## 인터랙션 플로우

이 커맨드는 3단계 인터랙션으로 진행됩니다. 각 단계에서 반드시 사용자 질문 도구를 호출하세요.

### Step 1. Organization 선택 & 에이전트 탐색 (slug가 없을 때만)

slug가 직접 주어지면 (`/relay-install @alice/doc-writer`) 이 단계를 건너뛰고 Step 2로 갑니다.

#### 1-1. Organization 선택
`relay orgs list --json` 을 실행하여 사용자의 Organization 목록을 가져옵니다.

**사용자 질문 도구 호출:**
- question: "어디서 에이전트를 찾을까요?"
- options: Organization이 있으면 `["<org1_name>", "<org2_name>", ...]`, 없으면 이 단계를 건너뛰고 바로 공개 에이전트 탐색으로 진행

**응답 처리:**
- Organization 이름 선택 → 1-2. Org 에이전트 탐색으로 진행

#### 1-2. Org 에이전트 탐색
선택된 Organization에서 에이전트를 검색합니다.
`relay search <keyword>` 명령어를 실행합니다 (필요하면 여러 키워드로 반복).
또는 `relay list --org <org-slug> --json`으로 전체 목록을 가져옵니다.

검색 결과를 번호 리스트로 보여줍니다:

```
검색 결과 (3개)

1. @alice/doc-writer — 기술 문서 자동화
   /write-doc, /api-doc

2. @bob/code-reviewer — PR 리뷰 자동화
   /review, /suggest

3. @carol/test-gen — 테스트 코드 생성
   /gen-test, /coverage
```

**사용자 질문 도구 호출:**
- question: "어떤 에이전트를 설치할까요?"
- options: `["1", "2", "3", "다시 검색", "돌아가기"]`

"다시 검색" → 새 키워드로 1-2 반복
"돌아가기" → 1-1로 돌아감
번호 선택 → 해당 에이전트의 slug로 설치 진행

#### 1-3. Org 에이전트 목록 (전체 보기)
`relay list --org <org-slug> --json` 을 실행합니다.

에이전트 목록을 번호 리스트로 보여줍니다 (1-2와 동일 형식).

**사용자 질문 도구 호출:**
- question: "어떤 에이전트를 설치할까요?"
- options: `["1", "2", ..., "돌아가기"]`

"돌아가기" → 1-1로 돌아감
번호 선택 → 해당 에이전트의 slug로 설치 진행

### Step 2. 설치 & 배치 범위 선택

#### 2-1. 패키지 다운로드
`relay install <@org/agent> --json` 명령어를 실행합니다.
- 공개 에이전트 (public): `relay install <@org/agent> --json`
- 링크 공유 에이전트 (private): `relay install <slug> --json`
  - 접근 권한이 없으면 CLI가 **purchase_info** (구매 안내 메시지 + URL)를 표시합니다.
  - 접근 링크 코드가 있으면: `relay access <slug> --code <code>` 로 접근 부여 + 자동 설치를 한번에 수행합니다.
  - Org 멤버이면 접근 확인 없이 바로 설치됩니다.
- Org 전용 에이전트 (internal): `relay install @<org-slug>/<agent-slug> --json`
  - Org 가입이 필요하면: `relay join <org-slug> --code <invite-code>` 를 먼저 실행합니다.
  - 또는 `--join-code <code>`로 가입+설치를 한번에 할 수 있습니다.
- CLI가 init과 login을 자동으로 처리합니다 (사용자가 별도 실행할 필요 없음).
- JSON 출력에서 `install_path` (패키지 경로)를 확인합니다.

**private 에이전트 접근 거부 처리:**
- CLI가 403 + `GATED_ACCESS_REQUIRED` 에러를 반환하면:
  1. purchase_info의 message와 url을 사용자에게 표시합니다.
  2. "접근 링크 코드가 있으신가요?"라고 물어봅니다.
  3. 코드가 있으면 `relay access <slug> --code <code>`를 실행합니다.
  4. 코드가 없으면 purchase_info의 url로 구매 안내합니다.

#### 2-2. 배치 범위 선택 (필수 — 이 단계를 절대 건너뛰지 마세요)

**반드시 사용자에게 글로벌/로컬 중 어디에 설치할지 물어보세요.** 에이전트 메타데이터(tags, requires 등)가 없어도 반드시 물어봐야 합니다. 메타데이터가 없으면 글로벌을 추천하되, 사용자 확인은 필수입니다.

에이전트의 성격을 분석하여 글로벌/로컬 중 적합한 쪽을 추천합니다.

**추천 로직:**
- **글로벌 추천** — 범용 유틸리티 에이전트: 코드 리뷰, 문서 생성, 테스트, 번역 등 프로젝트에 무관하게 사용하는 도구성 에이전트
- **로컬 추천** — 프로젝트 특화 에이전트: 특정 프레임워크/스택 전용, 프로젝트별 워크플로우, 팀 내부 컨벤션에 의존하는 에이전트

판단 기준 (다운로드된 패키지의 relay.yaml과 콘텐츠를 분석):
1. `tags`에 특정 프레임워크/스택 키워드가 있으면 (nextjs, supabase, react 등) → 로컬 추천
2. `requires`에 프로젝트 종속 의존성이 있으면 (npm 패키지, 특정 파일 구조) → 로컬 추천
3. rules/ 파일이 있으면 (프로젝트 컨벤션 주입) → 로컬 추천
4. 범용 키워드 (utility, review, docs, testing 등) → 글로벌 추천
5. 판단이 어려우면 → 글로벌 추천 (기본값)

**사용자 질문 도구 호출:**
- question: "{추천 이유}. {추천}에 설치할까요?"
- options: `["글로벌 (모든 프로젝트) ✓ 추천", "로컬 (이 프로젝트만)"]` 또는 `["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만) ✓ 추천"]`

예시:
- "범용 코드 리뷰 도구입니다. 글로벌에 설치할까요?" → `["글로벌 (모든 프로젝트) ✓ 추천", "로컬 (이 프로젝트만)"]`
- "Next.js + Supabase 전용 에이전트입니다. 이 프로젝트에 설치할까요?" → `["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만) ✓ 추천"]`

**응답 처리:**
- "글로벌" → 홈 디렉토리의 에이전트 설정 디렉토리에 배치 (예: `~/.claude/`, `~/.gemini/` 등 현재 에이전트 환경에 따라)
- "로컬" → 현재 프로젝트의 에이전트 설정 디렉토리에 배치

#### 2-3. 에이전트 환경에 맞게 배치
다운로드된 패키지(`install_path`)에서 파일을 읽고 선택된 범위에 배치합니다:
- 글로벌: `<install_path>/commands/` → 홈 디렉토리의 에이전트 설정 디렉토리 하위 `commands/`에 복사, skills/ 동일
- 로컬: `<install_path>/commands/` → 프로젝트의 에이전트 설정 디렉토리 하위 `commands/`에 복사, skills/ 동일
- agents/, rules/ 파일도 같은 방식으로 배치합니다.
- **충돌 확인**: 같은 이름의 파일이 이미 있으면 사용자에게 덮어쓸지 물어봅니다.

#### 2-4. 배치 정보 기록 (필수)
배치 완료 후 반드시 `relay deploy-record`를 실행합니다:
```
relay deploy-record <slug> --scope <global|local> --files <배치된_파일1> <배치된_파일2> ...
```

{{REQUIREMENTS_CHECK}}
{{ERROR_HANDLING_GUIDE}}

### Step 3. 완료 & 팔로우 제안

#### 3-1. 완료 안내
- 배치된 파일과 활성화된 커맨드 목록을 보여줍니다.
#### 3-2. 공유 가이드 (필수 — 설치 완료 시 반드시 표시)
설치 완료 후 아래 공유용 설치 가이드를 표시합니다. 복사 가능한 코드 블록으로 보여줍니다.

```
주변인에게 공유하세요:

{{GUIDE_INSTRUCTION}}
https://relayax.com/api/registry/{owner}/{slug}/guide.md
```

- `{slug}`가 `@owner/agent` 형식이면 `{owner}`과 `{slug}`를 분리하여 URL을 구성합니다.
- CLI가 이미 설치된 사용자를 위한 짧은 버전도 함께 표시합니다: `/relay:relay-install {slug}`

#### 3-4. 사용 제안
- "바로 사용해볼까요?" 제안

#### 3-5. 업데이트 확인
- `relay check-update` 명령어를 실행합니다.
- CLI 업데이트가 있으면 안내합니다: "relay v{new} available. Run: npm update -g relayax-cli"
- 다른 에이전트 업데이트가 있으면 안내합니다.

## 예시

### 인터랙티브 모드 (/relay-install)
→ relay orgs list --json 실행
→ 사용자 질문 도구: "어디서 에이전트를 찾을까요?" → ["Alice's Org (alice)", "Acme Corp"]
→ "Alice's Org" 선택 → "어떤 에이전트를 찾고 계세요?"
→ relay search "문서" 실행 → 결과 리스트 표시
→ 사용자 질문 도구: "어떤 에이전트를 설치할까요?" → ["1", "2", "3", "다시 검색"]
→ "1" 선택 (@alice/doc-writer)
→ 사용자 질문 도구: "어디에 설치할까요?" → ["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만)"]
→ "글로벌" 선택
→ 설치 + 배치 + deploy-record
→ 사용자 질문 도구: "@alice을 팔로우할까요?" → ["팔로우", "건너뛰기"]
→ "✓ 설치 완료! /write-doc를 사용해볼까요?"

### 다이렉트 모드 (/relay-install @alice/doc-writer)
→ relay install @alice/doc-writer --json 실행 (Step 1 건너뜀)
→ 사용자 질문 도구: "어디에 설치할까요?" → ["글로벌 (모든 프로젝트)", "로컬 (이 프로젝트만)"]
→ 설치 + 배치 + deploy-record
→ 사용자 질문 도구: "@alice을 팔로우할까요?" → ["팔로우", "건너뛰기"]
→ "✓ 설치 완료! /write-doc를 사용해볼까요?"
