## Step 0. 환경 감지

sandbox 환경(Cowork, Codex 등)에서는 `$HOME`이 격리될 수 있습니다.
아래 명령어로 확인하세요:

```bash
ls ~/.relay/token 2>/dev/null && echo "token-ok" || echo "token-missing"
```

`token-missing`이면, 이 세션에서 `relay login --device`로 새로 로그인해야 합니다.
이미 로그인한 토큰이 있다면 환경변수로 전달할 수도 있습니다:

```bash
export RELAY_TOKEN=<토큰>
```

`token-ok`이면 이 단계를 건너뛰세요.

## Step 1. Relay CLI 설치

relay CLI가 설치되어 있지 않다면:

```bash
npm install -g relayax-cli
```

Node.js가 없는 경우:
- macOS: `brew install node`
- Windows: `winget install OpenJS.NodeJS.LTS`
- Linux: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && source ~/.bashrc && nvm install --lts`

npm 권한 오류 시:
```bash
mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
npm install -g relayax-cli
```

이미 설치되어 있다면 최신 버전으로 업데이트하고 init을 재실행합니다:

```bash
npm update -g relayax-cli
relay init
```
