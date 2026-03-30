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
