import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import { detectAgentCLIs } from '../lib/ai-tools.js'
import { resolveProjectPath } from '../lib/paths.js'
import { getValidToken, API_URL } from '../lib/config.js'
import {
  USER_COMMANDS,
  BUILDER_COMMANDS,
  getGlobalCommandPath,
} from '../lib/command-adapter.js'
import { getAgentStatusEntries, findUnmanagedContent } from '../lib/agent-status.js'

interface StatusResult {
  login: { authenticated: boolean; username?: string }
  agent: { detected: string | null; global_commands: boolean; local_commands: boolean }
  project: { is_agent: boolean; name?: string; slug?: string; version?: string } | null
}

async function resolveUsername(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return undefined
    const body = await res.json() as { username?: string }
    return body.username
  } catch {
    return undefined
  }
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show current anpm environment status')
    .option('--project <dir>', 'Project root path (default: cwd, env: ANPM_PROJECT_PATH)')
    .action(async (opts: { project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)

      // 1. Login status
      const token = await getValidToken()
      let username: string | undefined
      if (token) {
        username = await resolveUsername(token)
      }

      // 2. Agent detection
      const detected = detectAgentCLIs(projectPath)
      const primaryAgent = detected.length > 0 ? detected[0] : null

      // Global command status
      const hasGlobal = USER_COMMANDS.every((cmd) =>
        fs.existsSync(getGlobalCommandPath(cmd.id))
      )

      // Local Builder command status
      let hasLocal = false
      if (primaryAgent) {
        const localDir = path.join(projectPath, primaryAgent.skillsDir, 'commands', 'anpm')
        hasLocal = BUILDER_COMMANDS.some((cmd) =>
          fs.existsSync(path.join(localDir, `${cmd.id}.md`))
        )
      }

      // 3. Agent project info
      const relayYamlPath = path.join(projectPath, '.relay', 'relay.yaml')
      let project: StatusResult['project'] = null

      if (fs.existsSync(relayYamlPath)) {
        try {
          const yaml = await import('js-yaml')
          const content = fs.readFileSync(relayYamlPath, 'utf-8')
          const raw = yaml.load(content) as Record<string, unknown>
          project = {
            is_agent: true,
            name: String(raw.name ?? ''),
            slug: String(raw.slug ?? ''),
            version: String(raw.version ?? ''),
          }
        } catch {
          project = { is_agent: true }
        }
      } else {
        project = { is_agent: false }
      }

      // 4. Installed agents status
      const agentEntries = getAgentStatusEntries()
      const unmanagedItems = findUnmanagedContent(projectPath)

      // 5. Output
      if (json) {
        const result = {
          login: { authenticated: !!token, username },
          agent: {
            detected: primaryAgent?.name ?? null,
            global_commands: hasGlobal,
            local_commands: hasLocal,
          },
          project,
          installed_agents: agentEntries,
          unmanaged: unmanagedItems,
        }
        console.log(JSON.stringify(result))
      } else {
        console.log('')

        // Login
        if (token && username) {
          console.log(`  \x1b[32m✓\x1b[0m Login: \x1b[36m${username}\x1b[0m`)
        } else if (token) {
          console.log(`  \x1b[32m✓\x1b[0m Login: authenticated`)
        } else {
          console.log(`  \x1b[31m✗\x1b[0m Login: not authenticated (\x1b[33manpm login\x1b[0m)`)
        }

        // Harness detection
        if (primaryAgent) {
          const globalLabel = hasGlobal ? '\x1b[32mglobal ✓\x1b[0m' : '\x1b[31mglobal ✗\x1b[0m'
          const localLabel = hasLocal ? '\x1b[32mlocal ✓\x1b[0m' : '\x1b[2mlocal —\x1b[0m'
          console.log(`  \x1b[32m✓\x1b[0m Harness: \x1b[36m${primaryAgent.name}\x1b[0m (${globalLabel} ${localLabel})`)
        } else {
          console.log(`  \x1b[31m✗\x1b[0m Harness: not detected`)
        }

        // Agent project
        if (project?.is_agent && project.name) {
          console.log(`  \x1b[32m✓\x1b[0m Project: \x1b[36m${project.name}\x1b[0m v${project.version}`)
        } else {
          console.log(`  \x1b[2m—\x1b[0m Project: not an agent`)
        }

        // Installed agents table
        if (agentEntries.length > 0) {
          console.log(`\n  \x1b[1mInstalled agents (${agentEntries.length}):\x1b[0m`)
          for (const entry of agentEntries) {
            const statusIcon = entry.status === 'active' ? '✅' : entry.status === 'broken' ? '⚠️' : '—'
            const sourceLabel = entry.source.startsWith('registry') ? 'registry'
              : entry.source.startsWith('local:') ? 'local'
              : entry.source.startsWith('git:') ? 'git'
              : entry.source.startsWith('link:') ? 'link'
              : entry.source.startsWith('adopted:') ? 'adopted'
              : entry.source
            const harnessNames = entry.harnesses.length > 0 ? entry.harnesses.join(', ') : '—'
            console.log(`    ${statusIcon} \x1b[36m${entry.slug}\x1b[0m  \x1b[90m${sourceLabel}\x1b[0m  v${entry.version}  → ${harnessNames}`)
          }

          // Broken symlink warnings
          const brokenEntries = agentEntries.filter((e) => e.brokenSymlinks.length > 0)
          if (brokenEntries.length > 0) {
            console.log('')
            for (const entry of brokenEntries) {
              console.log(`    \x1b[33m⚠️ ${entry.slug}: ${entry.brokenSymlinks.length} broken symlink(s)\x1b[0m`)
              console.log(`       Run: anpm uninstall ${entry.slug}`)
            }
          }
        }

        // Unmanaged content
        if (unmanagedItems.length > 0) {
          console.log(`\n  \x1b[1mUnmanaged content (${unmanagedItems.length}):\x1b[0m`)
          for (const item of unmanagedItems.slice(0, 10)) {
            console.log(`    \x1b[33m⚠️\x1b[0m ${item.type}/${item.name}  \x1b[90m(${item.harness})\x1b[0m`)
          }
          if (unmanagedItems.length > 10) {
            console.log(`    \x1b[90m...and ${unmanagedItems.length - 10} more\x1b[0m`)
          }
          console.log(`\n    \x1b[90mTip: anpm adopt <path> to manage with anpm\x1b[0m`)
        }

        console.log('')
      }
    })
}
