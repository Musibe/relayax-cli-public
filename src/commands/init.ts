import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { detectAgentCLIs, detectGlobalCLIs, AI_TOOLS, type AITool } from '../lib/ai-tools.js'
import { resolveProjectPath } from '../lib/paths.js'
import {
  USER_COMMANDS,
  formatCommandFile,
  getGlobalCommandDir,
  getGlobalCommandPath,
  getGlobalCommandDirForTool,
  getGlobalCommandPathForTool,
} from '../lib/command-adapter.js'
import { loadInstalled, saveInstalled } from '../lib/config.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

function showWelcome(): void {
  const lines = [
    '',
    '  \x1b[33m⚡\x1b[0m \x1b[1manpm\x1b[0m — Agent Marketplace',
    '',
    '  Connects anpm commands to your agent CLI.',
    '',
    '  \x1b[2mUser commands (global)\x1b[0m',
    '  /anpm-explore     Discover & recommend agents',
    '  /anpm-create      Create & publish agents',
    '  /anpm-status      Installation status & Organizations',
    '  /anpm-uninstall   Remove agents',
    '',
    '  \x1b[2mCLI commands\x1b[0m',
    '  anpm install      Install an agent (one-liner)',
    '  anpm publish      Re-publish (--patch/--minor/--major)',
    '',
  ]
  console.log(lines.join('\n'))
}

/**
 * Install global User commands to all detected agent CLIs.
 * Installs to ~/{skillsDir}/commands/anpm/.
 * Removes existing files not in the current command list.
 */
/** Removed legacy commands → replacement mapping */
const LEGACY_COMMANDS: Record<string, string> = {
  'relay-install': 'anpm install (CLI) or /anpm-explore',
  'relay-publish': 'anpm publish --patch (CLI) or /anpm-create',
}

export function installGlobalUserCommands(overrideTools?: AITool[]): { installed: boolean; commands: string[]; tools: string[]; removed: string[] } {
  const globalCLIs = overrideTools ?? detectGlobalCLIs()
  const currentIds = new Set(USER_COMMANDS.map((c) => c.id))
  const commands: string[] = []
  const tools: string[] = []
  const removed: string[] = []

  const targetDirs = globalCLIs.map((t) => ({ name: t.name, dir: getGlobalCommandDirForTool(t.skillsDir), getPath: (id: string) => getGlobalCommandPathForTool(t.skillsDir, id) }))

  for (const target of targetDirs) {
    fs.mkdirSync(target.dir, { recursive: true })

    // Remove files not in current list + legacy notices
    for (const file of fs.readdirSync(target.dir)) {
      const id = file.replace(/\.md$/, '')
      if (!currentIds.has(id)) {
        fs.unlinkSync(path.join(target.dir, file))
        if (LEGACY_COMMANDS[id] && !removed.includes(id)) {
          removed.push(id)
        }
      }
    }

    // Install current commands (overwrite)
    for (const cmd of USER_COMMANDS) {
      fs.writeFileSync(target.getPath(cmd.id), formatCommandFile(cmd))
    }

    tools.push(target.name)
  }

  for (const cmd of USER_COMMANDS) {
    commands.push(cmd.id)
  }

  return { installed: true, commands, tools, removed }
}

/**
 * Check if global User commands are already installed.
 */
export function hasGlobalUserCommands(overrideTools?: AITool[]): boolean {
  if (overrideTools) {
    return overrideTools.every((tool) =>
      USER_COMMANDS.every((cmd) =>
        fs.existsSync(getGlobalCommandPathForTool(tool.skillsDir, cmd.id))
      )
    )
  }
  return USER_COMMANDS.every((cmd) =>
    fs.existsSync(getGlobalCommandPath(cmd.id))
  )
}


export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Install anpm slash commands to agent CLIs')
    .option('--tools <tools>', 'Specify agent CLIs to install (comma-separated)')
    .option('--all', 'Install to all detected agent CLIs')
    .option('--auto', 'Auto-install to all detected CLIs without prompts')
    .option('--project <dir>', 'Project root path (default: cwd, env: ANPM_PROJECT_PATH)')
    .action(async (opts: { tools?: string; all?: boolean; auto?: boolean; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // auto mode: --auto flag, --all flag, or stdin is not a TTY (but NOT --json alone)
      const autoMode = opts.auto === true || opts.all === true || !process.stdin.isTTY

      const projectPath = resolveProjectPath(opts.project)
      const detected = detectAgentCLIs(projectPath)

      // ── 0. In --json mode, error if --tools/--all not specified ──
      if (json && !opts.tools && !opts.all && !opts.auto) {
        const detectedOptions = detected.map((t) => ({ value: t.value, label: t.name }))
        if (detectedOptions.length === 0) {
          detectedOptions.push(...AI_TOOLS.slice(0, 5).map((t) => ({ value: t.value, label: t.name })))
        }
        console.error(JSON.stringify({
          error: 'MISSING_TOOLS',
          message: 'Select agent CLIs to install.',
          fix: `anpm init --tools <tool1,tool2> --json or anpm init --all --json`,
          options: detectedOptions,
        }))
        process.exit(1)
      }

      // ── 1. Install global User commands ──
      let globalStatus: 'installed' | 'updated' | 'already' = 'already'

      let globalTools: string[] = []

      let removedCommands: string[] = []
      {
        const result = installGlobalUserCommands()
        globalStatus = hasGlobalUserCommands() ? 'updated' : 'installed'
        globalTools = result.tools
        removedCommands = result.removed

        // Register relay-core in installed.json
        const installed = loadInstalled()
        installed['anpm-core'] = {
          version: pkg.version,
          installed_at: new Date().toISOString(),
          files: result.commands.map((c) => getGlobalCommandPath(c)),
          type: 'system',
        }
        saveInstalled(installed)
      }

      if (!autoMode) {
        showWelcome()
      }

      // ── 2. Output ──
      if (json) {
        console.log(JSON.stringify({
          status: 'ok',
          global: {
            status: globalStatus,
            path: getGlobalCommandDir(),
            commands: USER_COMMANDS.map((c) => c.id),
          },
        }))
      } else {
        console.log(`\n\x1b[32m✓ anpm initialized\x1b[0m\n`)

        // Legacy command migration notice
        if (removedCommands.length > 0) {
          console.log(`  \x1b[33m⚠ Changed commands:\x1b[0m`)
          for (const id of removedCommands) {
            console.log(`    \x1b[31m✗ /${id}\x1b[0m → ${LEGACY_COMMANDS[id]}`)
          }
          console.log()
        }

        // Global
        {
          const toolNames = globalTools.length > 0 ? globalTools.join(', ') : '(no CLI detected)'
          console.log(`  \x1b[36mCommands (global)\x1b[0m — ${globalStatus === 'updated' ? 'updated' : 'installed'}`)
          console.log(`  Detected CLIs: \x1b[36m${toolNames}\x1b[0m`)
          for (const cmd of USER_COMMANDS) {
            console.log(`    /${cmd.id}`)
          }
          console.log()
        }

        console.log('  To create an agent, use \x1b[33manpm create <name>\x1b[0m.')
        console.log()
        console.log('  Restart your IDE to activate slash commands.')
      }
    })
}
