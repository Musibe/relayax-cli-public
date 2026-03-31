에이전트 패키지를 새로 만듭니다.
콘텐츠를 분석하고, 포지셔닝하고, relay.yaml을 작성한 뒤 배포합니다.

> 빌더는 터미널 환경에서 작업합니다. CLI 명령어를 직접 실행하세요.

## 1. 콘텐츠 파악

`relay package --init --json`으로 소스를 스캔합니다.
결과의 `sources[]`에서 사용자에게 어떤 콘텐츠를 포함할지 물어봅니다.

선택된 콘텐츠의 파일을 직접 읽어 기능을 파악합니다:
- SKILL.md, 에이전트 파일, 커맨드 파일의 내용
- 참조하는 스킬/에이전트 의존성

## 2. 포지셔닝

콘텐츠 분석을 기반으로 에이전트를 하나의 "제품"으로 포지셔닝합니다.

분석 관점:
- 이 에이전트가 **무엇을 하는** 에이전트인지
- 어떤 **기술 스택/도메인**에 특화되어 있는지
- 설치자에게 **어떤 가치**를 제공하는지

이름(name)은 한국어 가능. slug는 영문 소문자+하이픈.
설명은 설치자 관점으로 ("~를 자동화합니다").

## 3. requires 판단

콘텐츠 파일을 읽고 requires를 판단합니다:

- **env**: 환경변수 참조를 찾고 맥락에서 필수/선택 판단
  - 핵심 로직에서 사용 → `required: true`
  - 테스트/선택 기능에서 사용 → `required: false`
- **cli**: 외부 CLI 도구 참조 (playwright, ffmpeg 등)
- **npm**: import/require 패키지
- **mcp**: MCP 서버 참조 (supabase, github 등)
- **runtime**: Node.js/Python 최소 버전
- **agents**: 의존하는 다른 relay 에이전트

## 4. 보안 점검

콘텐츠 파일에서 시크릿/개인정보를 확인합니다:
- 하드코딩된 API 키, 토큰 (sk-*, ghp_*, AKIA* 등)
- 이메일, 전화번호 등 개인정보
- 발견 시 **반드시 경고**하고 환경변수 대체 안내
- 파일 컨텍스트를 읽어 실제 시크릿 vs 예시 코드를 구분

## 5. relay.yaml 작성 & 배포

판단 결과를 relay.yaml에 반영합니다:
- name, slug, description, version, tags
- requires (판단 결과)
- visibility, org (사용자에게 확인)

`relay publish --json`으로 배포합니다.

## 6. 공유 문구

배포 완료 후 `relay publish` 출력에 포함된 공유 문구를 보여줍니다.
CLI가 이미 설치된 사용자를 위한 짧은 버전도 함께 표시합니다.

{{ERROR_HANDLING_GUIDE}}
