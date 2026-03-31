에이전트를 만들거나 업데이트하여 relay에 배포합니다.
relay.yaml이 없으면 새로 만들고, 있으면 변경사항을 반영합니다.

> 빌더는 터미널 환경에서 작업합니다. CLI 명령어를 직접 실행하세요.

## 분기: 최초 생성 vs 업데이트

`.relay/relay.yaml`이 있는지 확인합니다.

- **없음** → 아래 "최초 생성" 플로우
- **있음** → 아래 "업데이트" 플로우

---

## 최초 생성 (relay.yaml 없음)

### 1. 콘텐츠 파악

`relay package --init --json`으로 소스를 스캔합니다.
결과의 `sources[]`에서 사용자에게 어떤 콘텐츠를 포함할지 물어봅니다.

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

### 3. requires 판단 + 보안 점검

콘텐츠 파일을 읽고 requires를 판단합니다:

- **env**: 환경변수 참조를 찾고 맥락에서 필수/선택 판단
  - 핵심 로직에서 사용 → `required: true`
  - 테스트/선택 기능에서 사용 → `required: false`
- **cli**: 외부 CLI 도구 참조 (playwright, ffmpeg 등)
- **npm**: import/require 패키지
- **mcp**: MCP 서버 참조 (supabase, github 등)
- **runtime**: Node.js/Python 최소 버전
- **agents**: 의존하는 다른 relay 에이전트

보안 점검:
- 하드코딩된 API 키, 토큰 (sk-*, ghp_*, AKIA* 등)
- 파일 컨텍스트를 읽어 실제 시크릿 vs 예시 코드를 구분
- 발견 시 **반드시 경고**하고 환경변수 대체 안내

### 4. relay.yaml 작성 & 배포

판단 결과를 relay.yaml에 반영합니다:
- name, slug, description, version, tags
- requires (판단 결과)
- org: `relay orgs list --json`으로 Org 목록을 조회합니다.
  - Org가 있으면: 개인 배포 vs Org 배포를 사용자에게 물어봅니다.
  - Org가 없으면: 개인 배포로 진행합니다.
- visibility: Org 선택 결과에 따라 옵션이 달라집니다:
  - **Org 없이 배포**: `public`, `private` (2개)
  - **Org에 배포**: `public`, `private`, `internal` (3개)
  - `public` — 누구나 설치
  - `private` — 접근 링크가 있는 사람만 설치
  - `internal` — Org 멤버만 설치 (Org 배포 시에만 선택 가능)

`relay publish --json`으로 배포합니다.

---

## 업데이트 (relay.yaml 있음)

### 1. 변경 사항 확인

`relay package --json`으로 현재 상태를 확인합니다.
- 변경된 콘텐츠 (modified)
- 새로 추가된 콘텐츠 (new_items)

사용자에게 어떤 부분을 변경하려는지 물어봅니다:
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

`relay publish --json`으로 배포합니다.
버전 범프가 필요하면 사용자에게 patch/minor/major 중 확인합니다.

---

## 공유 문구

배포 완료 후 `relay publish` 출력에 포함된 공유 문구를 보여줍니다.

{{ERROR_HANDLING_GUIDE}}
