## Step 2. 로그인

먼저 로그인 상태를 확인합니다. 이미 로그인되어 있으면 이 단계를 건너뛰세요.

- 환경 A: `relay whoami`
- 환경 B: `npx relayax-cli whoami`

로그인이 필요하면 아래 방법 중 환경에 맞는 것을 사용하세요.

### 방법 1: 브라우저 콜백 (환경 A — 로컬 터미널)

```bash
relay login
```

- 브라우저가 자동으로 열리면 GitHub 또는 카카오 계정으로 로그인합니다.
- 브라우저가 열리지 않으면 출력된 URL을 별도로 엽니다: `open <URL>` (macOS) / `xdg-open <URL>` (Linux)

"✓ 로그인 완료"가 출력되면 다음 단계로 진행합니다.

### 방법 2: Device Code (환경 B — 샌드박스)

```bash
npx relayax-cli login --device
```

- 화면에 URL과 8자리 코드가 표시됩니다.
- 표시된 URL을 브라우저에서 열고, 코드를 입력하고 로그인을 승인합니다.
- CLI가 자동으로 승인을 감지하고 "✓ 로그인 완료"를 출력합니다.
