## Step 1. Relay CLI 준비 및 업데이트

### 환경 A (터미널)

CLI가 설치되어 있지 않다면:

```bash
npm install -g relayax-cli
relay init
```

이미 설치되어 있다면 **반드시 최신 버전으로 업데이트**합니다:

```bash
npm update -g relayax-cli
relay init
```

`relay init`은 slash command를 설치/업데이트합니다. 업데이트 후 반드시 실행하세요.

Node.js가 없는 경우:
- macOS: `brew install node`
- Windows: `winget install OpenJS.NodeJS.LTS`
- Linux: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && source ~/.bashrc && nvm install --lts`

### 환경 B (MCP)

**Step 1-1. 버전 확인**: `relay_check_update` tool을 반드시 호출하세요.
- `status: "up_to_date"` → 최신 버전. Step 1-2로.
- `status: "updates_available"` → 사용자에게 업데이트 안내:
  > CLI 업데이트가 있습니다. 터미널에서 `npm update -g relayax-cli`를 실행해주세요.

  사용자가 업데이트 완료 후 Claude를 재시작하면 최신 MCP 서버가 적용됩니다.

**Step 1-2. slash command 설치**: `relay_init` tool을 반드시 호출하세요.
- `/relay-install`, `/relay-publish` 등 slash command가 설치/업데이트됩니다.
- 이미 최신이면 자동으로 건너뜁니다.
