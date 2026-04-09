import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Command } from 'commander'
import { loadManifest, type RelayManifest } from '../lib/manifest.js'
import { resolveProjectPath } from '../lib/paths.js'
import { resolveProviderApiKey } from '../lib/anpm-config.js'
import { loadInstalled, loadGlobalInstalled, getProjectAnpmDir } from '../lib/config.js'
import { AnthropicProvider } from '../lib/cloud-providers/anthropic.js'
import { mapRequiresToPackages } from '../lib/cloud-providers/package-mapper.js'
import type { CloudProvider, SkillDir } from '../lib/cloud-providers/provider.js'
import type { DeployRegistry } from '../types.js'
import { trackCommand } from '../lib/step-tracker.js'
import { reportCliError } from '../lib/error-report.js'

const SUPPORTED_PROVIDERS = ['anthropic'] as const

/** Scan skills directories and return SkillDir entries */
function scanSkillDirs(agentPath: string): SkillDir[] {
  const results: SkillDir[] = []
  const skillsPaths = [
    path.join(agentPath, 'skills'),
    path.join(agentPath, '.claude', 'skills'),
    path.join(agentPath, '.anpm', 'skills'),
  ]

  for (const skillsRoot of skillsPaths) {
    if (!fs.existsSync(skillsRoot)) continue
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillPath = path.join(skillsRoot, entry.name)
      const skillMd = path.join(skillPath, 'SKILL.md')
      if (!fs.existsSync(skillMd)) continue

      const files: string[] = []
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const fp = path.join(dir, f.name)
          if (f.isDirectory()) walk(fp)
          else files.push(fp)
        }
      }
      walk(skillPath)
      results.push({ name: entry.name, path: skillPath, files })
    }
  }

  return results
}

/** Load deploy registry from .anpm/deploy.json */
function loadDeployRegistry(projectPath: string): DeployRegistry {
  const dir = getProjectAnpmDir()
  const file = path.join(dir, 'deploy.json')
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DeployRegistry
  } catch {
    return {}
  }
}

/** Save deploy registry */
function saveDeployRegistry(projectPath: string, registry: DeployRegistry): void {
  const dir = getProjectAnpmDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify(registry, null, 2))
}

/** Hash manifest for change detection */
function hashManifest(manifest: RelayManifest): string {
  const content = JSON.stringify({ agent: manifest.agent, cloud: manifest.cloud, requires: manifest.requires })
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy [slug]')
    .description('Deploy an agent to a cloud provider')
    .option('--to <provider>', 'Target cloud provider (e.g., anthropic)')
    .option('--api-key <key>', 'Provider API key')
    .option('--project <dir>', 'Project root path')
    .action(async (slugInput: string | undefined, opts: { to?: string; apiKey?: string; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      trackCommand('deploy')

      try {
        const projectPath = resolveProjectPath(opts.project)

        // ── 1. Resolve agent source ──
        let agentPath: string
        let manifest: RelayManifest | null
        let agentSlug: string

        if (slugInput) {
          // Installed agent
          const local = loadInstalled()
          const global = loadGlobalInstalled()
          const entry = local[slugInput] ?? global[slugInput]
          if (!entry) {
            throw new Error(`Agent "${slugInput}" not found. Install it first: anpm install ${slugInput}`)
          }
          const anpmDir = getProjectAnpmDir()
          agentPath = path.join(anpmDir, 'agents', slugInput)
          if (!fs.existsSync(agentPath)) {
            // Try legacy .relay path
            const relayPath = path.join(projectPath, '.relay', 'agents', slugInput)
            if (fs.existsSync(relayPath)) {
              agentPath = relayPath
            } else {
              throw new Error(`Agent directory not found: ${agentPath}`)
            }
          }
          const result = loadManifest(agentPath)
          manifest = result.manifest
          agentSlug = slugInput
        } else {
          // Current directory (builder mode)
          agentPath = projectPath
          const result = loadManifest(projectPath)
          manifest = result.manifest
          agentSlug = manifest?.slug ?? manifest?.name ?? path.basename(projectPath)
        }

        if (!manifest) {
          throw new Error('No anpm.yaml found. Specify an agent slug or run from a project with anpm.yaml.')
        }

        // ── 2. Determine provider ──
        const cloudConfig = manifest.cloud
        if (!cloudConfig) {
          throw new Error('No cloud: section in anpm.yaml. Add cloud provider config to deploy.')
        }

        let providerName = opts.to
        if (!providerName) {
          const providers = Object.keys(cloudConfig).filter(k => typeof cloudConfig[k] === 'object')
          if (providers.length === 1) {
            providerName = providers[0]
          } else if (providers.length === 0) {
            throw new Error('No providers configured in cloud: section.')
          } else {
            throw new Error(`Multiple providers found (${providers.join(', ')}). Specify one with --to.`)
          }
        }

        if (!SUPPORTED_PROVIDERS.includes(providerName as typeof SUPPORTED_PROVIDERS[number])) {
          throw new Error(`Provider '${providerName}' is not yet supported. Available: ${SUPPORTED_PROVIDERS.join(', ')}`)
        }

        // ── 3. Resolve API key ──
        const apiKey = resolveProviderApiKey(providerName, opts.apiKey)
        if (!apiKey) {
          throw new Error(
            `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} API key not found.\n` +
            `Set ${providerName === 'anthropic' ? 'ANTHROPIC_API_KEY' : providerName.toUpperCase() + '_API_KEY'} or run:\n` +
            `  anpm config set provider.${providerName}.api-key <key>`
          )
        }

        // ── 4. Check for changes ──
        const deployReg = loadDeployRegistry(projectPath)
        const manifestHash = hashManifest(manifest)
        const existing = deployReg[agentSlug]?.[providerName]

        if (existing && existing.manifest_hash === manifestHash) {
          if (json) {
            console.log(JSON.stringify({ status: 'no_changes', agent_id: existing.agent_id, environment_id: existing.environment_id }))
          } else {
            console.error('No changes detected. Skipping deploy.')
            console.error(`  Agent ID: ${existing.agent_id}`)
          }
          return
        }

        // ── 5. Create provider ──
        let provider: CloudProvider
        if (providerName === 'anthropic') {
          provider = new AnthropicProvider(apiKey)
        } else {
          throw new Error(`Provider '${providerName}' not implemented`)
        }

        if (!json) console.error(`Validating ${providerName} credentials...`)
        const valid = await provider.validateCredentials()
        if (!valid) {
          throw new Error(`Invalid ${providerName} API key. Check your key and try again.`)
        }

        // ── 6. Upload skills ──
        const skillDirs = scanSkillDirs(agentPath)
        let uploadedSkills: { skill_id: string; name: string }[] = []

        if (skillDirs.length > 0) {
          if (!json) console.error(`Uploading ${skillDirs.length} skill(s)...`)
          uploadedSkills = await provider.uploadSkills(skillDirs)
          if (!json) {
            for (const s of uploadedSkills) {
              console.error(`  ✓ ${s.name} → ${s.skill_id}`)
            }
          }
        }

        // ── 7. Create environment ──
        if (!json) console.error('Creating environment...')
        const anthConfig = cloudConfig.anthropic as Record<string, unknown> | undefined
        const packages = manifest.requires ? mapRequiresToPackages(manifest.requires as Record<string, unknown>) : {}
        const envName = `anpm-${agentSlug.replace(/[@/]/g, '-').replace(/^-/, '')}`

        const envId = await provider.createEnvironment({
          name: envName,
          packages,
          networking: (anthConfig?.networking as 'unrestricted' | 'limited') ?? 'unrestricted',
          allowed_hosts: anthConfig?.allowed_hosts as string[] | undefined,
        })
        if (!json) console.error(`  ✓ Environment: ${envId}`)

        // ── 8. Create or update agent ──
        const agentConfig = {
          name: manifest.name ?? agentSlug,
          model: (anthConfig?.model as string) ?? 'claude-sonnet-4-6',
          system: manifest.agent?.system,
          tools: manifest.agent?.tools,
          skill_ids: uploadedSkills.map(s => s.skill_id),
          mcp_servers: manifest.agent?.mcp_servers,
        }

        let agentId: string
        let agentVersion: number

        if (existing) {
          if (!json) console.error('Updating agent...')
          const result = await provider.updateAgent(existing.agent_id, existing.agent_version, agentConfig)
          agentId = result.agent_id
          agentVersion = result.version
        } else {
          if (!json) console.error('Creating agent...')
          const result = await provider.createAgent(agentConfig)
          agentId = result.agent_id
          agentVersion = result.version
        }
        if (!json) console.error(`  ✓ Agent: ${agentId} (v${agentVersion})`)

        // ── 9. Save deploy record ──
        if (!deployReg[agentSlug]) deployReg[agentSlug] = {}
        deployReg[agentSlug][providerName] = {
          agent_id: agentId,
          agent_version: agentVersion,
          environment_id: envId,
          skill_ids: uploadedSkills.map(s => s.skill_id),
          deployed_at: new Date().toISOString(),
          manifest_hash: manifestHash,
        }
        saveDeployRegistry(projectPath, deployReg)

        // ── 10. Output ──
        if (json) {
          console.log(JSON.stringify({
            status: 'deployed',
            agent_id: agentId,
            agent_version: agentVersion,
            environment_id: envId,
            skill_ids: uploadedSkills.map(s => s.skill_id),
            deployed_at: deployReg[agentSlug][providerName].deployed_at,
          }))
        } else {
          console.error('')
          console.error(`\x1b[32m✓ Deployed to ${providerName}\x1b[0m`)
          console.error(`  Agent:       ${agentId} (v${agentVersion})`)
          console.error(`  Environment: ${envId}`)
          console.error(`  Skills:      ${uploadedSkills.length}`)
          console.error('')
          console.error(`  Start a session:`)
          console.error(`    anpm session start ${agentSlug} --provider ${providerName}`)
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        reportCliError('deploy', 'DEPLOY_FAILED', msg)
        if (json) {
          console.error(JSON.stringify({ error: 'DEPLOY_FAILED', message: msg }))
        } else {
          console.error(`\x1b[31m오류: ${msg}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
