### Requirements 체크리스트 (필수 — 항목이 있으면 반드시 수행)

`relay.yaml`의 `requires` 섹션을 읽고, **각 항목을 하나씩 확인하여 체크리스트로 표시**합니다.
requires 섹션이 없거나 비어있으면 이 단계를 건너뜁니다.

**출력 형식** (반드시 이 형식으로 사용자에게 보여줍니다):
```
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

[agents]
  ✅ @alice/doc-writer — 이미 설치됨
  📦 @bob/utils — 미설치 → 설치 중...
```

**처리 규칙 (각 카테고리별):**

1. **runtime**: `node --version`, `python3 --version`으로 확인. 버전 미달이면 ❌ 표시 후 업그레이드 안내.
2. **cli**: `which <name>`으로 확인.
   - 설치됨 → ✅
   - 미설치 + `install` 필드 있음 → 사용자에게 설치할지 물어본 후 실행
   - 미설치 + `install` 필드 없음 → ❌ 표시 후 수동 설치 안내
3. **npm**: `npm list <package> 2>/dev/null`으로 확인.
   - 설치됨 → ✅
   - 미설치 + required → `npm install <package>` 실행
   - 미설치 + optional → ❌ 표시 후 안내만
4. **env**: `echo $<NAME>`으로 확인.
   - 설정됨 → ✅
   - 미설정 + required → ❌ 표시 후 `description`과 함께 설정 방법 안내
   - 미설정 + optional → ⚠️ 표시 후 용도 안내
5. **mcp**: MCP 서버 설정이 필요한 경우 ⚙️ 표시 후 설정 방법을 상세히 안내.
   - `config` 필드가 있으면 settings.json에 추가할 JSON 블록을 보여줍니다.
   - `env` 필드가 있으면 필요한 환경변수도 함께 안내합니다.
6. **agents**: `relay list --json`으로 설치 여부 확인.
   - 설치됨 → ✅
   - 미설치 → `relay install <@author/agent> --json` 실행하여 재귀 설치

**중요**: 모든 required 항목이 ❌인 경우, 체크리스트 끝에 경고를 표시합니다:
```
⚠️  필수 요구사항이 충족되지 않았습니다. 에이전트 기능이 제한될 수 있습니다.
```
