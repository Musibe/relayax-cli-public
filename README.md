# relay

**The package manager for AI agents.**

Write once, run on any harness. One command install. Built-in usage analytics.

```bash
npx relayax-cli install @gstack/code-review
```

```
 ╭──────────────────────────────────────────────╮
 │                                              │
 │   relay — AI agent distribution for humans   │
 │   and machines.                              │
 │                                              │
 │   ✓ installed @gstack/code-review (v2.1.0)   │
 │   3 skills, 1 agent ready                    │
 │                                              │
 ╰──────────────────────────────────────────────╯
```

---

## Why

AI agents are stuck in silos. You build an agent for Claude Code — it doesn't work on OpenClaw. You share it on GitHub — no one knows it exists. You have no idea if anyone actually uses it.

**Relay fixes this.**

| Problem | Relay |
|---|---|
| Agents locked to one harness | Cross-harness compatibility (Claude, OpenClaw, nanoclaw) |
| No distribution channel | `relay install` — one command, done |
| Zero feedback from users | Built-in analytics — see which skills get used |

---

## Quick Start

```bash
# Install an agent — no setup required
npx relayax-cli install @author/agent-name

# Or install globally
npm i -g relayax-cli
relay install @author/agent-name
```

That's it. The agent is ready in your `.relay/agents/` directory, compatible with your harness.

---

## For Agent Builders

```bash
# Publish your agent to the registry
relay publish

# See who's using it
relay status --analytics
```

Relay tracks skill-level usage out of the box. No extra setup. You'll know exactly which skills land and which don't — so you can ship better agents, faster.

### Package Format

```yaml
# team.yaml
name: code-review
version: 2.1.0
harness:
  - claude
  - openclaw
  - nanoclaw
agents:
  - name: reviewer
    type: passive
skills:
  - name: review-pr
  - name: security-check
  - name: style-lint
```

One spec. Every harness.

---

## Commands

| Command | What it does |
|---|---|
| `relay install <name>` | Install an agent |
| `relay search <keyword>` | Find agents in the registry |
| `relay publish` | Publish your agent |
| `relay list` | List installed agents |
| `relay status` | Check environment + analytics |
| `relay update` | Update agents to latest |
| `relay uninstall <name>` | Remove an agent |
| `relay diff <name>` | See what changed between versions |

All output is JSON by default (for AI agents). Add `--pretty` for human-readable format.

---

## How It Works

```
                    relay install @team/agent
                            │
                 ╭──────────┴──────────╮
                 │   Relay Registry    │
                 │  (relay.ax cloud)   │
                 ╰──────────┬──────────╯
                            │
                 ╭──────────┴──────────╮
                 │  relay agent spec   │
                 │  (universal format) │
                 ╰──┬───────┬───────┬──╯
                    │       │       │
              ┌─────┴─┐ ┌──┴───┐ ┌─┴──────┐
              │Claude │ │Open  │ │nano    │
              │ Code  │ │Claw  │ │claw    │
              └───────┘ └──────┘ └────────┘
```

Relay resolves the right format for your harness automatically. Builders write one spec, users install with one command.

---

## AI-Native

Relay is built for AI agents as first-class users. The CLI outputs structured JSON so agents can search, install, and manage other agents autonomously.

```bash
# An agent searching for tools
relay search "database migration" | jq '.results[].slug'

# An agent installing what it needs
relay install @tools/db-migrate
# → {"status":"ok","agent":"db-migrate","skills":["migrate","rollback","seed"]}
```

Relay also ships as an **MCP server**, so any MCP-compatible agent can use it directly:

```bash
relay mcp
```

---

## Open Core

The CLI and agent spec are open source (MIT). Build agents, publish them, self-host your own registry — no vendor lock-in.

[relay.ax](https://relayax.com) provides the hosted registry with:
- Private agent hosting
- Organization management & access control
- Usage analytics dashboard
- Enterprise SSO & audit logs

---

## Community

- [25+ production agents](https://relayax.com) ready to install
- [Builder docs](https://relayax.com/docs) for creating your own
- [Discord](#) for help and discussion

---

<p align="center">
  <sub>Built by <a href="https://relayax.com">RelayAX</a></sub>
</p>
