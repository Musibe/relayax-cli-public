import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { Command } from 'commander'
import { resolveProjectPath } from '../lib/paths.js'
import { loadManifest } from '../lib/manifest.js'
import { loadMergedInstalled } from '../lib/config.js'
import { AI_TOOLS } from '../lib/ai-tools.js'
import { parseInstallSource } from '../lib/install-source.js'
import type { InstalledAgent } from '../types.js'

// ─── Harness → CLI command mapping ───

interface HarnessMapping {
  name: string
  command: string
  skillsDir: string
  type: 'cli' | 'gui'
}

const HARNESS_MAP: Record<string, HarnessMapping> = {
  claude: { name: 'Claude Code', command: 'claude', skillsDir: '.claude', type: 'cli' },
  codex: { name: 'Codex', command: 'codex', skillsDir: '.codex', type: 'cli' },
  gemini: { name: 'Gemini CLI', command: 'gemini', skillsDir: '.gemini', type: 'cli' },
  cursor: { name: 'Cursor', command: 'cursor', skillsDir: '.cursor', type: 'gui' },
  windsurf: { name: 'Windsurf', command: 'windsurf', skillsDir: '.windsurf', type: 'gui' },
  cline: { name: 'Cline', command: 'cline', skillsDir: '.cline', type: 'cli' },
  roocode: { name: 'RooCode', command: 'roocode', skillsDir: '.roo', type: 'cli' },
}

// Dotfiles to inherit from real HOME
const INHERITED_DOTFILES = [
  '.ssh', '.gitconfig', '.git-credentials', '.npmrc', '.config',
  '.zshrc', '.bashrc', '.profile', '.env',
]

export function registerRun(program: Command): void {
  program
    .command('run <harness>')
    .description('Run a harness with isolated agent environment')
    .option('--with <agents>', 'Comma-separated agent slugs to activate (overrides anpm.yaml)')
    .option('--profile <name>', 'Use a named profile from ~/.anpm/profiles/')
    .option('--project <dir>', 'Project root path')
    .allowUnknownOption(true)
    .action(async (harness: string, opts: { with?: string; profile?: string; project?: string }, cmd: Command) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)

      // 1. Resolve harness
      const mapping = HARNESS_MAP[harness.toLowerCase()]
      if (!mapping) {
        const available = Object.keys(HARNESS_MAP).join(', ')
        if (json) {
          console.error(JSON.stringify({ error: 'UNKNOWN_HARNESS', message: `Harness '${harness}' not found. Available: ${available}` }))
        } else {
          console.error(`\x1b[31m✖ Harness '${harness}' not found.\x1b[0m\n  Available: ${available}`)
        }
        process.exit(1)
      }

      // 2. Determine which agents to activate
      let agentSlugs: string[]

      if (opts.with) {
        agentSlugs = opts.with.split(',').map((s) => s.trim())
      } else if (opts.profile) {
        agentSlugs = loadProfile(opts.profile)
      } else {
        const { manifest } = loadManifest(projectPath)
        if (!manifest?.agents || Object.keys(manifest.agents).length === 0) {
          if (json) {
            console.error(JSON.stringify({ error: 'NO_AGENTS', message: 'No agents specified. Use --with, --profile, or add agents to anpm.yaml.' }))
          } else {
            console.error('\x1b[31m✖ No agents specified.\x1b[0m')
            console.error('  Use --with <agents>, --profile <name>, or add agents to anpm.yaml.')
          }
          process.exit(1)
        }
        agentSlugs = Object.keys(manifest.agents)
      }

      // 3. Resolve agent directories from installed.json
      const { global: globalInstalled, local: localInstalled } = loadMergedInstalled()
      const allInstalled: Record<string, InstalledAgent> = { ...globalInstalled, ...localInstalled }
      const agentDirs: { slug: string; dir: string }[] = []

      for (const slug of agentSlugs) {
        const entry = allInstalled[slug]
        if (entry?.files?.[0]) {
          agentDirs.push({ slug, dir: entry.files[0] })
        } else {
          if (!json) console.error(`\x1b[33m⚠ Agent ${slug} not installed, skipping\x1b[0m`)
        }
      }

      if (agentDirs.length === 0) {
        if (json) console.error(JSON.stringify({ error: 'NO_AGENTS_INSTALLED', message: 'None of the specified agents are installed.' }))
        else console.error('\x1b[31m✖ None of the specified agents are installed.\x1b[0m')
        process.exit(1)
      }

      // 4. Extract passthrough args (everything after --)
      const passthroughArgs = cmd.args.filter((a) => a !== harness)

      // 5. Launch based on harness type
      if (mapping.type === 'cli') {
        await launchCliHarness(mapping, agentDirs, projectPath, passthroughArgs, json)
      } else {
        await launchGuiHarness(mapping, agentDirs, projectPath, passthroughArgs, json)
      }
    })
}

async function launchCliHarness(
  mapping: HarnessMapping,
  agentDirs: { slug: string; dir: string }[],
  projectPath: string,
  passthroughArgs: string[],
  json: boolean,
): Promise<void> {
  const realHome = os.homedir()
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'anpm-env-'))

  try {
    // Inherit dotfiles from real HOME
    for (const dotfile of INHERITED_DOTFILES) {
      const src = path.join(realHome, dotfile)
      if (fs.existsSync(src)) {
        const dest = path.join(tempHome, dotfile)
        try {
          fs.symlinkSync(src, dest)
        } catch { /* skip if fails */ }
      }
    }

    // Inherit .anpm directory (for token, config, etc.)
    const anpmSrc = path.join(realHome, '.anpm')
    if (fs.existsSync(anpmSrc)) {
      fs.symlinkSync(anpmSrc, path.join(tempHome, '.anpm'))
    }

    // Inherit harness settings (credentials, settings.json, etc.)
    const harnessDir = path.join(realHome, mapping.skillsDir)
    const tempHarnessDir = path.join(tempHome, mapping.skillsDir)
    fs.mkdirSync(tempHarnessDir, { recursive: true })

    // Symlink settings files (not skills/)
    if (fs.existsSync(harnessDir)) {
      for (const entry of fs.readdirSync(harnessDir, { withFileTypes: true })) {
        if (['skills', 'commands', 'rules', 'agents'].includes(entry.name)) continue
        try {
          fs.symlinkSync(
            path.join(harnessDir, entry.name),
            path.join(tempHarnessDir, entry.name),
          )
        } catch { /* skip */ }
      }
    }

    // Create skills/commands/rules/agents directories with only specified agents
    const contentDirs = ['skills', 'commands', 'rules', 'agents'] as const
    for (const dir of contentDirs) {
      const targetDir = path.join(tempHarnessDir, dir)
      fs.mkdirSync(targetDir, { recursive: true })

      for (const { dir: agentDir } of agentDirs) {
        const srcDir = path.join(agentDir, dir)
        if (!fs.existsSync(srcDir)) continue

        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const srcPath = path.join(srcDir, entry.name)
          const destPath = path.join(targetDir, entry.name)
          try {
            fs.symlinkSync(srcPath, destPath)
          } catch { /* skip duplicates */ }
        }
      }
    }

    if (!json) {
      console.error(`\x1b[2manpm run: launching ${mapping.name} with ${agentDirs.length} agent(s)\x1b[0m`)
      for (const { slug } of agentDirs) {
        console.error(`  \x1b[36m${slug}\x1b[0m`)
      }
      console.error('')
    }

    // Launch harness with HOME override
    const child = spawn(mapping.command, passthroughArgs, {
      cwd: projectPath,
      env: { ...process.env, HOME: tempHome },
      stdio: 'inherit',
    })

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code && code !== 0) reject(new Error(`${mapping.command} exited with code ${code}`))
        else resolve()
      })
      child.on('error', (err) => {
        reject(new Error(`Failed to launch ${mapping.command}: ${err.message}`))
      })
    })
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempHome, { recursive: true, force: true })
    } catch { /* best effort */ }
  }
}

async function launchGuiHarness(
  mapping: HarnessMapping,
  agentDirs: { slug: string; dir: string }[],
  projectPath: string,
  _passthroughArgs: string[],
  json: boolean,
): Promise<void> {
  // GUI harnesses: manipulate project-local harness directory
  const localHarnessDir = path.join(projectPath, mapping.skillsDir)

  if (!json) {
    console.error(`\x1b[33m⚠ GUI harness (${mapping.name}): full isolation not supported.\x1b[0m`)
    console.error(`  Setting up project-local ${mapping.skillsDir}/ with specified agents.`)
    console.error(`  Global agents may still be visible.\n`)
  }

  const contentDirs = ['skills', 'commands', 'rules', 'agents'] as const
  const created: string[] = []

  for (const dir of contentDirs) {
    const targetDir = path.join(localHarnessDir, dir)
    fs.mkdirSync(targetDir, { recursive: true })

    for (const { dir: agentDir } of agentDirs) {
      const srcDir = path.join(agentDir, dir)
      if (!fs.existsSync(srcDir)) continue

      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const srcPath = path.join(srcDir, entry.name)
        const destPath = path.join(targetDir, entry.name)
        if (fs.existsSync(destPath)) continue
        try {
          const rel = path.relative(path.dirname(destPath), srcPath)
          fs.symlinkSync(rel, destPath)
          created.push(destPath)
        } catch { /* skip */ }
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ status: 'ok', harness: mapping.name, symlinks: created.length, note: 'GUI harness - partial isolation' }))
  } else {
    console.log(`\x1b[32m✓\x1b[0m Set up ${created.length} symlinks in ${mapping.skillsDir}/`)
    console.log(`  Open ${mapping.name} to use the configured agents.`)
  }
}

function loadProfile(name: string): string[] {
  const profilePath = path.join(os.homedir(), '.anpm', 'profiles', `${name}.yaml`)
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml') as { load: (s: string) => unknown }
    const raw = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as { agents?: string[] } | null
    return raw?.agents ?? []
  } catch {
    throw new Error(`Failed to parse profile: ${profilePath}`)
  }
}
