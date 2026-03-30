# relay-cli

Agent Team Marketplace CLI - 에이전트 팀을 검색하고 설치하세요.

## Quick Start

```bash
# 글로벌 설치 없이 바로 사용
npx relay-cli install @author/team-name

# 또는 글로벌 설치
npm install -g relayax-cli
relay install @author/team-name
```

## Commands

| Command | Description |
|---------|-------------|
| `relay init` | 초기 설정 (설치 경로, API URL) |
| `relay search <keyword>` | 팀 검색 |
| `relay install <name>` | 팀 설치 |
| `relay list` | 설치된 팀 목록 |
| `relay uninstall <name>` | 팀 제거 |

## Options

- `--pretty` - 사람이 읽기 좋은 포맷으로 출력 (기본: JSON)
- `--json` - JSON 출력 (기본값, 에이전트 친화적)

## For AI Agents

relay CLI는 에이전트가 1차 사용자입니다. 모든 출력은 JSON 기본입니다.

```bash
# 에이전트가 팀 검색
relay search "keyword" | jq '.results[].slug'

# 에이전트가 팀 설치
relay install @author/team-name
# → {"status":"ok","team":"Team Name","commands":[...]}
```
