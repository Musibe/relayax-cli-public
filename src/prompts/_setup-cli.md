## Step 1. Relay CLI 준비

### 환경 A (터미널)

```bash
npm install -g relayax-cli
relay init
```

이미 설치되어 있다면 최신 버전으로 업데이트합니다:

```bash
npm update -g relayax-cli
relay init
```

Node.js가 없는 경우:
- macOS: `brew install node`
- Windows: `winget install OpenJS.NodeJS.LTS`
- Linux: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && source ~/.bashrc && nvm install --lts`

### 환경 B (샌드박스)

설치 없이 `npx`로 실행합니다. 이후 모든 `relay` 명령어를 `npx relayax-cli`로 대체하세요.

```bash
npx relayax-cli --version
```

정상 출력되면 준비 완료입니다.
