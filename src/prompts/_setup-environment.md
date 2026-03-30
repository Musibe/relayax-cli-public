## Step 0. 환경 감지

이 가이드는 여러 환경에서 실행될 수 있습니다. 아래 환경 감지를 먼저 수행하고, 이후 모든 Step에서 감지된 환경에 맞는 방법을 사용하세요.

### 환경 판별

```bash
which relay 2>/dev/null && echo "cli-ok" || echo "cli-missing"
```

- `cli-ok` → **환경 A (터미널 + CLI 설치됨)** — 바로 Step 1로
- `cli-missing` → 아래 확인:

```bash
npm install -g relayax-cli 2>/dev/null && echo "install-ok" || echo "sandbox"
```

- `install-ok` → **환경 A (터미널)** (`relay init` 실행 후 Step 1로)
- `sandbox` → **환경 B (샌드박스)** — 아래 MCP 설정으로 진행

### 환경 B: MCP Connector 자동 설정 (샌드박스)

샌드박스 환경(Cowork 등)에서는 네트워크가 제한되어 CLI로 직접 API 호출이 불가합니다.
대신 relay MCP 서버를 설정하면, 호스트 머신에서 API를 호출할 수 있습니다.

**relay MCP tool(`relay_status` 등)을 사용할 수 있는지 확인하세요.**
사용할 수 있다면 MCP가 이미 설정되어 있으므로 바로 Step 1로 진행합니다.

사용할 수 없다면 아래 절차로 MCP를 설정합니다:

1. Claude Desktop 설정 파일을 찾아 읽습니다:
```bash
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json 2>/dev/null || echo "{}"
```

2. 설정 파일에 아래 relay MCP 서버를 추가합니다 (기존 mcpServers가 있으면 거기에 추가, 없으면 새로 생성):
```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["relayax-cli@latest", "mcp"]
    }
  }
}
```

3. 사용자에게 **Claude Desktop을 재시작**해달라고 안내합니다.

4. 재시작 후 `relay_status` MCP tool이 사용 가능한지 확인합니다. 사용 가능하면 Step 1로 진행합니다.

### 환경별 실행 방법

이후 가이드의 모든 `relay <명령어>`는 감지된 환경에 따라 실행합니다:

| 가이드 지시 | A. 터미널 | B. 샌드박스 (MCP) |
|---|---|---|
| "relay status" | `relay status` | `relay_status` tool 호출 |
| "relay install X" | `relay install X` | `relay_install` tool 호출 (`slug: "X"`) |
| "relay publish" | `relay publish` | `relay_publish` tool 호출 |
| "relay login" | `relay login` | `relay_login` tool 호출 |
| "relay scan" | `relay package --init` | `relay_scan` tool 호출 |
| "relay check-update X" | `relay check-update X` | `relay_check_update` tool 호출 (`slug: "X"`) |
| "relay orgs list" | `relay orgs list --json` | `relay_org_list` tool 호출 |
| "relay orgs create" | `relay orgs create "이름" --json` | `relay_org_create` tool 호출 (`name: "이름"`) |
| "relay grant create" | `relay grant create --agent <slug>` | `relay_grant_create` tool 호출 (`agent_slug: "<slug>"`) |
| "relay grant use" | `relay grant use --code <code>` | `relay_grant_use` tool 호출 (`code: "<code>"`) |
| "relay access" | `relay access <slug> --code <code>` | `relay_access` tool 호출 (`slug`, `code`) |
| "relay join" | `relay join <slug> --code <code>` | `relay_join` tool 호출 (`code: "<code>"`) |
| "relay deploy-record" | `relay deploy-record <slug> --scope <scope> --files ...` | `relay_deploy_record` tool 호출 |

처음 판별한 환경을 이후 계속 사용합니다.
