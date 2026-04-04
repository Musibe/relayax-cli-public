에이전트를 만들거나 업데이트하여 relay에 배포합니다.
relay.yaml이 없으면 새로 만들고, 있으면 변경사항을 반영합니다.

> 빌더는 터미널 환경에서 작업합니다. CLI 명령어를 직접 실행하세요.

## 핵심 원칙: 의사결정 포인트에서 사용자 질문

각 단계에서 **선택지가 2개 이상**이면 반드시 사용자에게 질문하고 답변을 기다리세요.
(AskUserQuestion 등 사용자 입력을 받는 도구를 사용하세요.)
선택지가 1개뿐이거나 자동 판단이 가능하면 결과를 보여주고 바로 진행합니다.

### 사용자 입력이 필요한 경우 (멈추고 질문하고 답변을 기다림)
- 소스가 2개 이상 감지됨 → "어떤 콘텐츠를 포함할까요?"
- Org가 1개 이상 있음 → "개인 배포 vs Org 배포?"
- visibility 옵션이 2개 이상 → "공개 범위를 선택해주세요"
- 포지셔닝 확인 → 분석 결과를 보여주고 "이대로 진행할까요?"
- 배포 최종 확인 → relay.yaml 요약을 보여주고 "배포할까요?"

**질문 후 반드시 사용자의 답변을 받을 때까지 다음 단계로 넘어가지 마세요.**
텍스트로 질문을 출력한 뒤 혼자 답변하고 진행하면 안 됩니다.

### 자동 진행하는 경우 (질문 불필요)
- 소스가 1개뿐 → 해당 소스 자동 선택, 결과만 보여줌
- 이미 relay.yaml이 있고 변경사항이 명확함 → 요약 후 진행
- 로그인이 필요 → 자동으로 `relay login` 실행

## 분기: 최초 생성 vs 업데이트

`.relay/relay.yaml`이 있는지 확인합니다.

- **없음** → 아래 "최초 생성" 플로우
- **있음** → `relay package --json`으로 상태 확인
  - `no_contents` 에러 → relay.yaml에 sources/contents가 없는 레거시 상태. `relay package --init --json`으로 소스를 스캔하고 relay.yaml에 sources를 추가한 뒤 "업데이트" 플로우 진행
  - 정상 응답 → 아래 "업데이트" 플로우

---

## 최초 생성 (relay.yaml 없음)

### 1. 콘텐츠 파악

`relay package --init --json`으로 소스를 스캔합니다.

- **소스가 2개 이상** → `sources[]`를 정리하여 보여주고, **사용자에게 질문하여 어떤 콘텐츠를 포함할지 물어봅니다.** 사용자가 답변할 때까지 다음 단계로 넘어가지 마세요.
- **소스가 1개** → 해당 소스를 자동 선택하고 결과를 보여준 뒤 바로 진행합니다.

선택된 콘텐츠의 파일을 직접 읽어 기능을 파악합니다:
- SKILL.md, 에이전트 파일, 커맨드 파일의 내용
- 참조하는 스킬/에이전트 의존성

### 2. 포지셔닝

콘텐츠 분석을 기반으로 에이전트를 하나의 "제품"으로 포지셔닝합니다.

분석 관점:
- 이 에이전트가 **무엇을 하는** 에이전트인지
- 어떤 **기술 스택/도메인**에 특화되어 있는지
- 설치자에게 **어떤 가치**를 제공하는지

이름(name)은 한국어 가능. slug는 영문 소문자+하이픈.
설명은 설치자 관점으로 ("~를 자동화합니다").

포지셔닝 결과를 표로 정리하여 보여주고, **사용자에게 질문하여 확인받으세요.**
("이 포지셔닝으로 진행할까요? 수정할 부분이 있으면 알려주세요.")

### 3. requires 판단 + 보안 점검

콘텐츠 파일을 읽고 requires를 판단합니다:

- **env**: 환경변수 참조를 찾고 맥락에서 필수/선택 판단
  - 핵심 로직에서 사용 → `required: true`
  - 테스트/선택 기능에서 사용 → `required: false`
  - cookie, token 등 비표준적 env는 `setup_hint`에 획득 방법을 기술 권장
    - 예: `setup_hint: "1. klingai.com 로그인\n2. DevTools → Cookies\n3. cookie 문자열 복사"`
    - 일반 API 키(OPENAI_API_KEY 등)는 description만으로 충분
- **cli**: 외부 CLI 도구 참조 (playwright, ffmpeg 등)
- **npm**: import/require 패키지
- **mcp**: MCP 서버 참조 (supabase, github 등)
- **runtime**: Node.js/Python 최소 버전
- **agents**: 의존하는 다른 relay 에이전트

보안 점검:
- 하드코딩된 API 키, 토큰 (sk-*, ghp_*, AKIA* 등)
- 하드코딩된 cookie 값 (Cookie:, Set-Cookie, session_id=, _ga= 등)
- 하드코딩된 Bearer/JWT 토큰 (Bearer ey..., Authorization: 등)
- 100자 이상의 연속 alphanumeric/base64 문자열 (시크릿 의심)
- 단, placeholder는 무시: YOUR_XXX, <your-xxx>, sk-xxx, PASTE_HERE 등 명백한 예시값
- 파일 컨텍스트를 읽어 실제 시크릿 vs 예시 코드를 구분
- 발견 시 **반드시 경고**하고 환경변수 대체 안내

### 4. 배포 설정

`relay orgs list --json`으로 Org 목록을 조회합니다.

**항상 사용자에게 질문합니다** (AskUserQuestion 등 사용자 입력 도구 사용):
- **Org가 1개 이상** → "개인 배포 / {org이름}에 배포" 선택
- **Org가 없음** → "개인 배포 / 새 Organization 만들기" 선택
  - "새 Organization 만들기" 선택 시 → `relay orgs create "이름"` 실행 후 해당 Org에 배포

선택에 따라 **사용자에게 질문하여 visibility를 물어봅니다:**
- **Org 없이 배포**: `public`, `private` (2개)
- **Org에 배포**: `public`, `private`, `internal` (3개)
- `public` — 누구나 검색 및 설치 가능 (Org: 조직 밖의 누구나 사용 가능)
- `private` — 허가 코드 등록자만 사용 가능 (Org: 조직 내의 허가된 사용자만 사용 가능)
- `internal` — 조직 내의 누구나 사용 가능 (Org 배포 시에만 선택 가능)

### 5. relay.yaml 작성 & 배포

위 결과를 relay.yaml에 반영합니다:
- name, slug, description, version, tags
- requires (판단 결과)
- org, visibility
- **recommended_scope** — 설치 시 기본 배치 범위:
  - `local` — rules/ 디렉토리가 있거나 프레임워크 특화 태그(nextjs, react, vue, angular, svelte, nuxt, remix, astro, django, rails, laravel, spring, express, fastapi, flask)가 있을 때
  - `global` — 그 외 범용 도구

**사용자에게 질문하여 최종 확인** 후 배포합니다.

배포 명령어는 사용자의 선택에 따라 다릅니다:
- **개인 배포**: `relay publish --no-org --json`
- **Org 배포**: `relay publish --org {org_slug} --json`

⚠️ `relay publish --json`만 실행하면 org 선택 에러가 발생합니다. 반드시 `--no-org` 또는 `--org`를 명시하세요.

---

## 업데이트 (relay.yaml 있음)

### 1. 변경 사항 확인

`relay package --json`으로 현재 상태를 확인합니다.
- 변경된 콘텐츠 (modified)
- 새로 추가된 콘텐츠 (new_items)

**사용자에게 질문하여 어떤 부분을 변경하려는지 물어봅니다:**
- 콘텐츠 변경 반영 (sync)
- 새 스킬/커맨드 추가
- 설명/태그 개선
- requires 재분석

### 2. 필요한 부분만 업데이트

사용자 요청에 따라:
- **콘텐츠 추가**: 새 콘텐츠의 파일을 읽고 기능 파악 → relay.yaml의 contents에 추가
- **requires 변경**: 콘텐츠를 다시 읽고 requires 재판단
- **설명 개선**: 현재 포지셔닝을 분석하고 개선안 제안
- **보안 재점검**: 시크릿/개인정보 확인

### 3. 배포

변경 요약을 보여주고 **사용자에게 질문하여 최종 확인** 후 배포합니다.

배포 명령어는 사용자의 선택(또는 기존 relay.yaml 설정)에 따라:
- **개인 배포**: `relay publish --no-org --json`
- **Org 배포**: `relay publish --org {org_slug} --json`
버전 범프가 필요하면 사용자에게 질문하여 patch/minor/major 중 확인합니다.

---

## 배포 완료 후 공유 안내

`relay publish --json` 출력 결과를 파싱하여 다음을 보여주세요:

1. **배포 결과 요약** — slug, 버전, 공개 범위, URL
2. **설치 방법** — CLI 출력에 코드블록 형태로 이미 포함되어 있으므로, 그 내용을 사용자에게 안내합니다:
   - CLI: `npx relayax-cli install {slug}`
   - 에이전트 소개 페이지 URL
3. **공유 텍스트** — CLI 출력의 공유 블록(┌─ ... ─┘)을 그대로 안내합니다. 팀에 바로 복붙할 수 있는 코드블록 형태입니다.

{{ERROR_HANDLING_GUIDE}}
