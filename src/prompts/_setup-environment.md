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
- `sandbox` → **환경 B (샌드박스)** — `npx relayax-cli`로 실행

### 환경별 실행 방법

이후 가이드의 모든 `relay <명령어>`는 감지된 환경에 따라 실행합니다:

| 가이드 지시 | A. 터미널 | B. 샌드박스 |
|---|---|---|
| "relay whoami" | `relay whoami` | `npx relayax-cli whoami` |
| "relay install X" | `relay install X` | `npx relayax-cli install X` |
| "relay publish" | `relay publish` | `npx relayax-cli publish` |
| "relay login" | `relay login` | `npx relayax-cli login --device` |

처음 판별한 환경을 이후 계속 사용합니다.
