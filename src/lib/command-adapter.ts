import os from 'os'
import path from 'path'
import type { AITool } from './ai-tools.js'
import { EXPLORE_PROMPT, CREATE_PROMPT } from '../prompts/index.js'

export interface CommandContent {
  id: string
  description: string
  body: string
}

export interface ToolCommandAdapter {
  toolId: string
  getFilePath(commandId: string): string
  formatFile(content: CommandContent): string
}

/**
 * Local adapter — relative to project directory.
 * {projectPath}/{skillsDir}/commands/anpm/{id}.md
 */
export function createAdapter(tool: AITool): ToolCommandAdapter {
  return {
    toolId: tool.value,
    getFilePath(commandId: string): string {
      return path.join(tool.skillsDir, 'commands', 'anpm', `${commandId}.md`)
    },
    formatFile: formatCommandFile,
  }
}

/**
 * @deprecated Use getGlobalCommandPathForTool(skillsDir, commandId) instead.
 * Claude Code only path. Use ForTool version for multi-agent support.
 */
export function getGlobalCommandPath(commandId: string): string {
  return getGlobalCommandPathForTool('.claude', commandId)
}

/**
 * @deprecated Use getGlobalCommandDirForTool(skillsDir) instead.
 * Claude Code only path. Use ForTool version for multi-agent support.
 */
export function getGlobalCommandDir(): string {
  return getGlobalCommandDirForTool('.claude')
}

/**
 * Global command directory for a specific AI tool.
 * ~/{skillsDir}/commands/anpm/
 */
export function getGlobalCommandDirForTool(skillsDir: string): string {
  return path.join(os.homedir(), skillsDir, 'commands', 'anpm')
}

/**
 * Global command file path for a specific AI tool.
 */
export function getGlobalCommandPathForTool(skillsDir: string, commandId: string): string {
  return path.join(os.homedir(), skillsDir, 'commands', 'anpm', `${commandId}.md`)
}

/**
 * Format command content as a file.
 */
export function formatCommandFile(content: CommandContent): string {
  return `---\ndescription: ${content.description}\n---\n\n${content.body}\n`
}

// ─── Prompts managed in cli/src/prompts/*.md (SSOT) ───

// ─── User Commands (global install) ───

export const USER_COMMANDS: CommandContent[] = [
  {
    id: 'anpm-explore',
    description: 'Discover agents on the anpm marketplace and find ones that fit your project',
    body: EXPLORE_PROMPT,
  },
  {
    id: 'anpm-status',
    description: 'Show installed agents and organization status',
    body: `Shows installed agents and organization membership at a glance.

## How to run

### 1. Installed agents list

Run \`anpm list --json\`.

**JSON response structure:**
\`\`\`json
{
  "installed": [
    {
      "slug": "@author/agent-name",
      "version": "1.2.0",
      "installed_at": "2026-03-20T12:00:00.000Z",
      "scope": "global",
      "deploy_scope": "global",
      "org_slug": null
    }
  ]
}
\`\`\`

**Display each agent as:**

| Agent | Version | Scope | Installed |
|---|---|---|---|
| @author/agent-name | v1.2.0 | global | 3/20 |

- \`deploy_scope\`: \`"global"\` → global, \`"local"\` → local, missing → not deployed
- If \`org_slug\` is present, show \`[Org: slug]\`

### 2. Organization list

Run \`anpm orgs list --json\`.

**JSON response structure:**
\`\`\`json
{
  "orgs": [
    {
      "slug": "my-org",
      "name": "My Org",
      "description": "Description",
      "role": "owner"
    }
  ]
}
\`\`\`

**Display:**
- \`role\`: owner, admin, builder, member
- If org fetch fails, still show installed agents (local data).

### 3. Org agent list (optional)
- If \`--org <slug>\` argument is provided: also run \`anpm list --org <org-slug> --json\` to show that organization's agents.

### 4. Guidance
- If no agents are installed, suggest exploring with \`/anpm-explore\`.
- If orgs exist, show usage tips:
  - Install org agent: \`anpm install @<org-slug>/<agent>\`
  - Manage org: www.anpm.io/orgs/<slug>

## Example

User: /anpm-status
→ Run anpm list --json
→ Run anpm orgs list --json (can run in parallel)

**Installed agents (2)**

| Agent | Version | Scope | Installed |
|---|---|---|---|
| @alice/doc-writer | v1.2.0 | global | 3/20 |
| @bob/code-reviewer | v0.5.1 | local | 3/15 |

**My Organizations (2)**
- acme-corp — Acme Corp (owner)
- dev-guild — Dev Guild (member)

User: /anpm-status --org acme-corp
→ Above info + run \`anpm list --org acme-corp --json\`
→ Show available agents from the acme-corp organization`,
  },
  {
    id: 'anpm-uninstall',
    description: 'Remove an installed agent',
    body: `Remove an installed agent. The CLI cleans up both the package and deployed files.

## How to run

1. Run \`anpm uninstall <@author/slug> --json\`.
2. The CLI automatically handles:
   - Removing the \`.anpm/agents/\` package
   - Removing deployed files recorded in \`deployed_files\` (within agent config directories)
   - Cleaning up empty parent directories
   - Removing the entry from installed.json (both global and local)
3. Shows the result (agent name, number of files removed).

## Example

User: /anpm-uninstall @alice/doc-writer
→ Run anpm uninstall @alice/doc-writer --json
→ "✓ @alice/doc-writer removed (12 files deleted)"`,
  },
  {
    id: 'anpm-create',
    description: 'Create or update an agent and publish to anpm',
    body: CREATE_PROMPT,
  },
]

// ─── Builder Commands (local install) ───
// anpm-publish has been promoted to global, so this is currently empty.
// Running anpm init --auto updates all commands at once.

export const BUILDER_COMMANDS: CommandContent[] = []

