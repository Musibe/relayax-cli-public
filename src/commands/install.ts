import fs from 'fs'
import os from 'os'
import path from 'path'
import { Command } from 'commander'
import { fetchAgentInfo, reportInstall, sendUsagePing } from '../lib/api.js'
import type { AgentRegistryInfo } from '../types.js'
import { makeTempDir, removeTempDir, clonePackage } from '../lib/storage.js'
import { checkGitInstalled, buildGitUrl } from '../lib/git-operations.js'
import { loadInstalled, saveInstalled, loadGlobalInstalled, saveGlobalInstalled, getValidToken, API_URL } from '../lib/config.js'
import { resolveSlug } from '../lib/slug.js'
import { injectPreambleToAgent } from '../lib/preamble.js'
import { hasGlobalUserCommands, installGlobalUserCommands } from './init.js'
import { resolveProjectPath } from '../lib/paths.js'
import { reportCliError } from '../lib/error-report.js'
import { trackCommand } from '../lib/step-tracker.js'
import { deploySymlinks, checkRequires, printRequiresCheck } from '../lib/installer.js'
import { detectGlobalCLIs, AI_TOOLS, type AITool } from '../lib/ai-tools.js'
import { parseInstallSource } from '../lib/install-source.js'
import { installFromLocal } from '../lib/local-installer.js'
import { installFromGit } from '../lib/git-installer.js'
import { formatDetectedStructure } from '../lib/auto-detect.js'
import { loadManifest, addAgentToManifest, satisfiesRange } from '../lib/manifest.js'
import { updateLockEntry, loadLockfile } from '../lib/lockfile.js'

export function registerInstall(program: Command): void {
  program
    .command('install [slug]')
    .description('Install an agent package to .anpm/agents/')
    .option('--code <code>', 'Access code (for private/internal agents)')
    .option('--global', 'Global install (home directory)')
    .option('--local', 'Local install (project directory)')
    .option('--project <dir>', 'Project root path (default: cwd, env: ANPM_PROJECT_PATH)')
    .option('--path <subpath>', 'Subpath within a monorepo (for git installs)')
    .option('--yes', 'Skip confirmation prompts')
    .option('--save', 'Add agent to anpm.yaml agents')
    .option('--prune', 'Remove agents not in anpm.yaml')
    .action(async (slugInput: string | undefined, _opts: { code?: string; global?: boolean; local?: boolean; project?: string; path?: string; yes?: boolean; save?: boolean; prune?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(_opts.project)

      // ── Manifest mode (no args) ──
      if (!slugInput) {
        const { manifest, filePath: manifestPath } = loadManifest(projectPath)
        if (!manifest?.agents || Object.keys(manifest.agents).length === 0) {
          if (json) {
            console.log(JSON.stringify({ error: 'NO_MANIFEST', message: 'No anpm.yaml with agents found.' }))
          } else {
            console.error('No anpm.yaml with agents found. Run `anpm install <slug>` to install an agent.')
          }
          process.exit(1)
        }

        const agents = manifest.agents
        const _lock = loadLockfile(projectPath) // used in future for pinned versions
        const localInstalled = loadInstalled()
        let installed = 0
        let skipped = 0

        if (!json) console.error(`\x1b[2mInstalling from ${manifestPath}...\x1b[0m`)

        for (const [slug, range] of Object.entries(agents)) {
          // Check if already installed with compatible version
          const existing = localInstalled[slug]
          if (existing && satisfiesRange(existing.version, range)) {
            skipped++
            continue
          }

          try {
            const source = parseInstallSource(slug)
            if (source.type === 'local') {
              installFromLocal(source.absolutePath, { scope: 'local', projectPath })
            } else if (source.type === 'git') {
              installFromGit(source, { scope: 'local', projectPath })
            } else {
              // Registry install — reuse the existing flow by recursing
              // For now, use a simplified approach: call the single-agent install logic
              if (!json) console.error(`  Installing ${slug}...`)
              // We'll let the user run `anpm install <slug>` for registry agents
              // Full manifest registry install requires the same token/fetch flow
              if (!json) console.error(`  \x1b[33m⚠ Registry agent ${slug} — run: anpm install ${slug} --save\x1b[0m`)
              continue
            }

            // Update lock
            updateLockEntry(projectPath, slug, {
              version: existing?.version ?? '0.0.0',
              resolved: source.type === 'local' ? `local:${(source as { absolutePath: string }).absolutePath}` : `git:${slug}`,
            })

            installed++
            if (!json) console.error(`  \x1b[32m✓\x1b[0m ${slug}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (!json) console.error(`  \x1b[31m✖\x1b[0m ${slug}: ${msg}`)
          }
        }

        if (json) {
          console.log(JSON.stringify({ status: 'ok', installed, skipped, total: Object.keys(agents).length }))
        } else {
          console.log(`\n\x1b[32m✓\x1b[0m Manifest install complete: ${installed} installed, ${skipped} skipped`)
        }
        return
      }
      trackCommand('install', { slug: slugInput })

      // ── Source type branching ──
      const source = parseInstallSource(slugInput)

      if (source.type === 'local' || source.type === 'git') {
        try {
          const interactive = Boolean(process.stdin.isTTY) && !json
          const scope: 'global' | 'local' = _opts.global ? 'global' : 'local'

          let agentDir: string
          let installSlug: string
          let sourceTag: string

          if (source.type === 'local') {
            if (!json) console.error(`\x1b[2mInstalling from local path: ${source.absolutePath}\x1b[0m`)
            const result = installFromLocal(source.absolutePath, { scope, projectPath })

            // Confirm auto-detected structure if no relay.yaml
            if (result.detected.method !== 'relay-yaml' && interactive && !_opts.yes) {
              console.error(`\n  Detected structure (${result.detected.method}):`)
              console.error(formatDetectedStructure(result.detected))
              const { confirm } = await import('@inquirer/prompts')
              const ok = await confirm({ message: 'Install these?', default: true })
              if (!ok) { process.exit(0) }
            }

            agentDir = result.agentDir
            installSlug = `local/${result.name}`
            sourceTag = `local:${source.absolutePath}`
          } else {
            if (!json) console.error(`\x1b[2mInstalling from git: ${source.url}${source.ref ? `#${source.ref}` : ''}\x1b[0m`)
            const result = installFromGit(source, { scope, projectPath, subpath: _opts.path })

            if (result.detected.method !== 'relay-yaml' && interactive && !_opts.yes) {
              console.error(`\n  Detected structure (${result.detected.method}):`)
              console.error(formatDetectedStructure(result.detected))
              const { confirm } = await import('@inquirer/prompts')
              const ok = await confirm({ message: 'Install these?', default: true })
              if (!ok) { process.exit(0) }
            }

            agentDir = result.agentDir
            installSlug = result.slug
            sourceTag = `git:${source.host}:${source.user}/${source.repo}${source.ref ? `#${source.ref}` : ''}`
          }

          // Deploy symlinks to detected harnesses
          const deploy = await deploySymlinks(agentDir, scope, projectPath)
          for (const w of deploy.warnings) {
            if (!json) console.error(`\x1b[33m${w}\x1b[0m`)
          }

          // Record in installed.json
          const installRecord = {
            version: '0.0.0',
            installed_at: new Date().toISOString(),
            files: [agentDir],
            deploy_scope: scope,
            deployed_symlinks: deploy.symlinks,
            source: sourceTag,
          }
          if (scope === 'global') {
            const globalInstalled = loadGlobalInstalled()
            globalInstalled[installSlug] = installRecord
            saveGlobalInstalled(globalInstalled)
          } else {
            const installed = loadInstalled()
            installed[installSlug] = installRecord
            saveInstalled(installed)
          }

          // Count files
          function countFilesInDir(dir: string): number {
            let count = 0
            if (!fs.existsSync(dir)) return 0
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) count += countFilesInDir(path.join(dir, entry.name))
              else count++
            }
            return count
          }

          const fileCount = countFilesInDir(agentDir)
          const scopeLabel = scope === 'global' ? 'global' : 'local'

          if (json) {
            console.log(JSON.stringify({
              status: 'ok',
              slug: installSlug,
              source: sourceTag,
              files: fileCount,
              install_path: agentDir,
              scope,
              symlinks: deploy.symlinks,
            }))
          } else {
            console.log(`\n\x1b[32m✓ Installed ${installSlug}\x1b[0m`)
            console.log(`  path: \x1b[36m${agentDir}\x1b[0m`)
            console.log(`  scope: ${scopeLabel}`)
            console.log(`  files: ${fileCount}, symlinks: ${deploy.symlinks.length}`)
          }

          // --save: add to relay.yaml
          if (_opts.save) {
            addAgentToManifest(projectPath, installSlug, '*')
            if (!json) console.log(`  \x1b[32m✓\x1b[0m Added to anpm.yaml`)
          }

          return
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          reportCliError('install', 'INSTALL_FAILED', message)
          if (json) {
            console.error(JSON.stringify({ error: 'INSTALL_FAILED', message }))
          } else {
            console.error(`\x1b[31m✖ ${message}\x1b[0m`)
          }
          process.exit(1)
        }
      }

      // ── Registry install flow (existing) ──
      const tempDir = makeTempDir()

      try {
        // Resolve scoped slug and fetch agent metadata
        let agent: AgentRegistryInfo | undefined
        let slug: string
        let parsed: { owner: string; name: string; full: string }

        // Extract version from @owner/agent@version syntax (e.g. acme/writer@1.2.0)
        // Version-specific install is not yet supported by the registry API;
        // the match is kept for future use when per-version package URLs are available.
        const versionMatch = slugInput.match(/^(.+)@(\d+\.\d+\.\d+.*)$/)
        const actualSlugInput = versionMatch ? versionMatch[1] : slugInput

        parsed = await resolveSlug(actualSlugInput)
        slug = parsed.full

        // Helper: ensure a valid token exists, triggering auto-login in TTY if needed.
        // Returns the token string or null if login failed / not available.
        async function ensureToken(): Promise<string | null> {
          let token = await getValidToken()
          if (!token) {
            const isTTY = Boolean(process.stdin.isTTY)
            if (isTTY && !json) {
              console.error('\x1b[33m⚙ This agent requires login. Starting login...\x1b[0m')
              const { runLogin } = await import('./login.js')
              await runLogin()
              token = await getValidToken()
            }
          }
          return token ?? null
        }

        // Pre-fetch auto-login: --code always requires auth.
        if (_opts.code) {
          const token = await ensureToken()
          if (!token) {
            if (json) {
              console.error(JSON.stringify({
                error: 'LOGIN_REQUIRED',
                slug,
                message: 'This agent requires authentication. Run anpm login first.',
                fix: 'Run anpm login and try again.',
              }))
            } else {
              console.error('\x1b[31mThis agent requires authentication. Run anpm login first.\x1b[0m')
            }
            process.exit(1)
          }
        }

        try {
          agent = await fetchAgentInfo(slug)
        } catch (fetchErr) {
          const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          if (fetchMsg.includes('403')) {
            // Parse error body for membership_status, visibility, purchase_info
            let membershipStatus: string | undefined
            let errorVisibility: string | undefined
            let purchaseInfo: { message?: string; url?: string } | undefined
            try {
              const errBody = JSON.parse(fetchMsg.replace(/^.*?(\{)/, '{')) as Record<string, unknown>
              membershipStatus = typeof errBody.membership_status === 'string' ? errBody.membership_status : undefined
              errorVisibility = typeof errBody.visibility === 'string' ? errBody.visibility : undefined
              if (errBody.purchase_info && typeof errBody.purchase_info === 'object') {
                purchaseInfo = errBody.purchase_info as { message?: string; url?: string }
              }
            } catch { /* ignore parse errors */ }

            // --code provided → use unified access-codes API (handles both org join and agent grant)
            if (_opts.code) {
              if (!json) {
                console.error('\x1b[33m⚙ Requesting access with code...\x1b[0m')
              }
              const token = await getValidToken()
              if (!token) {
                if (json) {
                  console.error(JSON.stringify({
                    error: 'LOGIN_REQUIRED',
                    slug,
                    message: 'This agent requires authentication. Run anpm login first.',
                    fix: 'Run anpm login and try again.',
                  }))
                } else {
                  console.error('\x1b[31mThis agent requires authentication. Run anpm login first.\x1b[0m')
                }
                process.exit(1)
              }
              const codeRes = await fetch(`${API_URL}/api/access-codes/${_opts.code}/use`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                signal: AbortSignal.timeout(10000),
              })
              if (!codeRes.ok) {
                const codeBody = (await codeRes.json().catch(() => ({}))) as { error?: string; message?: string }
                const codeErrCode = codeBody.error ?? String(codeRes.status)
                if (codeErrCode === 'INVALID_LINK') throw new Error('Access code is invalid or expired.')
                throw new Error(codeBody.message ?? `Access request failed (${codeRes.status})`)
              }
              agent = await fetchAgentInfo(slug)
            }
            // No code provided: show appropriate error messages
            else if (errorVisibility === 'private' || purchaseInfo) {
              // Private agent: show purchase info + access hint
              if (json) {
                console.error(JSON.stringify({
                  error: 'ACCESS_REQUIRED',
                  message: 'This agent requires access.',
                  slug,
                  purchase_info: purchaseInfo ?? null,
                  fix: 'If you have an access code: anpm install ' + slugInput + ' --code <code>',
                }))
              } else {
                console.error('\x1b[31mThis agent requires access.\x1b[0m')
                if (purchaseInfo?.message) {
                  console.error(`\n  \x1b[36m${purchaseInfo.message}\x1b[0m`)
                }
                if (purchaseInfo?.url) {
                  console.error(`  \x1b[36m${purchaseInfo.url}\x1b[0m`)
                }
                console.error(`\n\x1b[33mIf you have an access code: anpm install ${slugInput} --code <code>\x1b[0m`)
              }
              process.exit(1)
            } else if (membershipStatus === 'member') {
              // Member but no access to this specific agent
              if (json) {
                console.error(JSON.stringify({
                  error: 'NO_ACCESS',
                  message: 'You do not have access to this agent.',
                  slug,
                  fix: 'If you have an access code, run `anpm install ' + slugInput + ' --code <code>`. Otherwise, contact the agent author.',
                }))
              } else {
                console.error('\x1b[31mYou do not have access to this agent.\x1b[0m')
              }
              process.exit(1)
            } else {
              if (json) {
                console.error(JSON.stringify({
                  error: 'ACCESS_REQUIRED',
                  message: 'This agent requires access.',
                  slug,
                  fix: 'If you have an access code: `anpm install ' + slugInput + ' --code <code>`',
                }))
              } else {
                console.error('\x1b[31mThis agent requires access.\x1b[0m')
                console.error('\x1b[33mIf you have an access code: `anpm install ' + slugInput + ' --code <code>`\x1b[0m')
              }
              process.exit(1)
            }
          } else {
            throw fetchErr
          }
        }

        if (!agent) throw new Error('Failed to fetch agent info.')

        // Re-bind as non-optional so TypeScript tracks the narrowing through nested scopes
        let resolvedAgent: AgentRegistryInfo = agent

        const isTTY = Boolean(process.stdin.isTTY)
        const interactive = isTTY && !json
        const defaultScope = resolvedAgent.recommended_scope ?? (resolvedAgent.type === 'passive' ? 'local' : 'global')

        // ── 1. AI tools selection (scope-independent, always detected from home dir) ──
        let selectedTools: AITool[] | undefined
        if (interactive) {
          const detected = detectGlobalCLIs()
          if (!detected.some((t) => t.value === 'claude')) {
            detected.push({ name: 'Claude Code', value: 'claude', skillsDir: '.claude' })
          }

          const detectedValues = new Set(detected.map((t) => t.value))
          const { checkbox } = await import('@inquirer/prompts')
          selectedTools = await checkbox<AITool>({
            message: 'Select AI tools to install (detected tools are pre-selected)',
            choices: AI_TOOLS.map((t) => ({
              name: t.name,
              value: t,
              checked: detectedValues.has(t.value),
            })),
          })
        }

        // ── 2. Install/update global slash commands ──
        if (selectedTools) {
          installGlobalUserCommands(selectedTools)
        } else if (!hasGlobalUserCommands()) {
          if (!json) {
            console.error('\x1b[33m⚙ Auto-installing global commands...\x1b[0m')
          }
          installGlobalUserCommands()
        }

        // ── 3. Scope resolution: flag > TTY prompt > auto ──
        let scope: 'global' | 'local'
        if (_opts.global) {
          scope = 'global'
        } else if (_opts.local) {
          scope = 'local'
        } else if (interactive) {
          const { select } = await import('@inquirer/prompts')
          const recommendLabel = defaultScope === 'global' ? 'global' : 'local'
          scope = await select<'global' | 'local'>({
            message: `Select install scope (author recommends: ${recommendLabel})`,
            choices: [
              { name: 'Global (~/.anpm/agents/) — available in all projects', value: 'global' },
              { name: 'Local (./.anpm/agents/) — this project only', value: 'local' },
            ],
            default: defaultScope,
          })
        } else {
          scope = defaultScope
        }

        const agentDir = scope === 'global'
          ? path.join(os.homedir(), '.anpm', 'agents', parsed.owner, parsed.name)
          : path.join(projectPath, '.anpm', 'agents', parsed.owner, parsed.name)

        // 2. Auth: public needs no token, private/internal requires login
        const isPublic = resolvedAgent.visibility === 'public' || !resolvedAgent.visibility
        let token: string | null = null
        if (!isPublic) {
          token = await ensureToken()
          if (!token) {
            if (json) {
              console.error(JSON.stringify({
                error: 'LOGIN_REQUIRED',
                slug,
                message: 'Authentication required. Run anpm login first.',
                fix: 'Run anpm login and try again.',
              }))
            } else {
              console.error('\x1b[31mAuthentication required. Run anpm login first.\x1b[0m')
            }
            process.exit(1)
          }
        }

        // 3. Download package via git clone
        const requestedVersion = versionMatch ? versionMatch[2] : undefined
        if (!resolvedAgent.git_url) {
          const errMsg = 'This agent needs to be re-published. Contact the builder.'
          if (json) {
            console.log(JSON.stringify({ error: 'NO_GIT_URL', message: errMsg }))
          } else {
            console.error(`\x1b[31m✖ ${errMsg}\x1b[0m`)
          }
          process.exit(1)
        }

        checkGitInstalled()
        const gitUrl = buildGitUrl(resolvedAgent.git_url, token ? { token } : undefined)
        await clonePackage(gitUrl, agentDir, requestedVersion)

        // Verify clone has actual files (not just .git)
        const clonedEntries = fs.readdirSync(agentDir).filter((f) => f !== '.git')
        if (clonedEntries.length === 0) {
          fs.rmSync(agentDir, { recursive: true, force: true })
          const errMsg = 'Agent package is empty. Ask the builder to re-publish.'
          if (json) {
            console.log(JSON.stringify({ error: 'EMPTY_PACKAGE', message: errMsg }))
          } else {
            console.error(`\x1b[31m✖ ${errMsg}\x1b[0m`)
          }
          process.exit(1)
        }

        // 4.5. Inject preamble (update check) into SKILL.md and commands
        injectPreambleToAgent(agentDir, slug)

        // 5. Deploy symlinks to detected AI tool directories
        const deploy = await deploySymlinks(agentDir, scope, projectPath, selectedTools)
        for (const w of deploy.warnings) {
          if (!json) console.error(`\x1b[33m${w}\x1b[0m`)
        }

        // 6. Count extracted files
        function countFiles(dir: string): number {
          let count = 0
          if (!fs.existsSync(dir)) return 0
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              count += countFiles(path.join(dir, entry.name))
            } else {
              count++
            }
          }
          return count
        }
        const fileCount = countFiles(agentDir)

        // 7. Record in installed.json (scope-aware)
        const installRecord = {
          agent_id: resolvedAgent.id,
          version: resolvedAgent.version,
          installed_at: new Date().toISOString(),
          files: [agentDir],
          deploy_scope: scope,
          deployed_symlinks: deploy.symlinks,
        }
        if (scope === 'global') {
          const globalInstalled = loadGlobalInstalled()
          globalInstalled[slug] = installRecord
          saveGlobalInstalled(globalInstalled)
        } else {
          const installed = loadInstalled()
          installed[slug] = installRecord
          saveInstalled(installed)
        }

        // 8. Report install + usage ping (non-blocking, agent_id based)
        await reportInstall(resolvedAgent.id, slug, resolvedAgent.version)
        sendUsagePing(resolvedAgent.id, slug, resolvedAgent.version)

        const result = {
          status: 'ok',
          agent: resolvedAgent.name,
          slug,
          version: resolvedAgent.version,
          commands: resolvedAgent.commands,
          files: fileCount,
          install_path: agentDir,
          scope,
          symlinks: deploy.symlinks,
          author: resolvedAgent.author ? {
            username: resolvedAgent.author.username,
            display_name: resolvedAgent.author.display_name ?? null,
            contact_links: resolvedAgent.author.contact_links ?? [],
          } : null,
          welcome: resolvedAgent.welcome ?? null,
        }

        if (json) {
          console.log(JSON.stringify(result))
        } else {
          const authorUsername = resolvedAgent.author?.username
          const authorSuffix = authorUsername ? `  \x1b[90mby @${authorUsername}\x1b[0m` : ''
          const scopeLabel = scope === 'global' ? 'global' : 'local'

          console.log(`\n\x1b[32m✓ ${resolvedAgent.name} installed\x1b[0m  v${resolvedAgent.version}${authorSuffix}`)
          console.log(`  path: \x1b[36m${agentDir}\x1b[0m`)
          console.log(`  scope: ${scopeLabel}`)
          console.log(`  files: ${fileCount}, symlinks: ${deploy.symlinks.length}`)
          const userCommands = resolvedAgent.commands.filter((c) => !c.name.startsWith('setup-'))
          if (userCommands.length > 0) {
            console.log('\n  Included commands:')
            for (const cmd of userCommands) {
              console.log(`    \x1b[33m/${cmd.name}\x1b[0m - ${cmd.description}`)
            }
          }

          // Usage hint (type-aware, excluding setup commands)
          const agentType = resolvedAgent.type
          const mainCommand = userCommands[0]
          if (agentType === 'passive') {
            console.log(`\n\x1b[33m💡 Applied automatically. No additional commands needed.\x1b[0m`)
          } else if (agentType === 'hybrid' && mainCommand) {
            console.log(`\n\x1b[33m💡 Applied automatically + use \x1b[1m/${mainCommand.name}\x1b[0m\x1b[33m for additional features.\x1b[0m`)
          } else if (mainCommand) {
            console.log(`\n\x1b[33m💡 Usage: \x1b[1m/${mainCommand.name}\x1b[0m`)
          } else {
            console.log(`\n\x1b[33m💡 Installed! Ready to use with your AI agent.\x1b[0m`)
          }

          // Requires check + setup CTA
          const requiresResults = checkRequires(agentDir)
          printRequiresCheck(requiresResults)

          const setupCmd = resolvedAgent.commands.find((c) => c.name.startsWith('setup-'))
          if (setupCmd && requiresResults.some((r) => r.status === 'missing' || r.status === 'warn')) {
            const toolNames = selectedTools
              ? selectedTools.map((t) => t.name).slice(0, 2).join(' or ')
              : 'Claude Code'
            console.log(`\n  \x1b[36m👉 Setup required.\x1b[0m`)
            console.log(`  \x1b[36m   Open ${toolNames} and run \x1b[1m/${setupCmd.name}\x1b[0m`)
          }

          // Cloud deploy hint
          const cloudConfig = (resolvedAgent as unknown as Record<string, unknown>).cloud_config
          if (cloudConfig) {
            const providers = (cloudConfig as Record<string, unknown>).supported_providers as string[] | undefined
            const providerStr = providers?.join(', ') ?? 'anthropic'
            console.log(`\n  ☁️  Cloud deploy available. Run: \x1b[36manpm deploy ${slugInput} --to ${providerStr}\x1b[0m`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportCliError('install', 'INSTALL_FAILED', message)
        console.error(JSON.stringify({ error: 'INSTALL_FAILED', message, fix: message }))
        process.exit(1)
      } finally {
        removeTempDir(tempDir)
      }
    })
}
