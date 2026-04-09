import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import yaml from 'js-yaml'
import { detectAgentCLIs } from '../lib/ai-tools.js'
import { trackCommand } from '../lib/step-tracker.js'
import {
  createAdapter,
  BUILDER_COMMANDS,
} from '../lib/command-adapter.js'
import { installGlobalUserCommands, hasGlobalUserCommands } from './init.js'
import { slugify } from '../lib/slug.js'
import { resolveProjectPath } from '../lib/paths.js'

const DEFAULT_DIRS = ['.anpm/skills', '.anpm/commands'] as const

/**
 * Install global User commands if not already present.
 */
function ensureGlobalUserCommands(): boolean {
  if (hasGlobalUserCommands()) return false
  installGlobalUserCommands()
  return true
}

export function registerCreate(program: Command): void {
  program
    .command('create <name>')
    .description('Create a new agent project')
    .option('--description <desc>', 'Agent description')
    .option('--slug <slug>', 'URL-safe identifier (lowercase, numbers, hyphens)')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--visibility <visibility>', 'Visibility (public, private, internal)')
    .option('--project <dir>', 'Project root path (default: cwd, env: ANPM_PROJECT_PATH)')
    .action(async (name: string, opts: { description?: string; slug?: string; tags?: string; visibility?: string; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      trackCommand('create')
      const projectPath = resolveProjectPath(opts.project)
      const relayDir = path.join(projectPath, '.anpm')
      const relayYamlPath = path.join(relayDir, 'anpm.yaml')
      const isTTY = Boolean(process.stdin.isTTY) && !json

      // 1. Error if .anpm/anpm.yaml already exists
      if (fs.existsSync(relayYamlPath)) {
        if (json) {
          console.error(JSON.stringify({ error: 'ALREADY_EXISTS', message: '.anpm/anpm.yaml already exists.', fix: 'Check your existing .anpm/anpm.yaml. To start fresh, delete it and try again.' }))
        } else {
          console.error('.anpm/anpm.yaml already exists. Use `anpm init` for existing agent projects.')
        }
        process.exit(1)
      }

      // 2. Collect metadata
      let slug = opts.slug ?? slugify(name)

      let description = opts.description ?? ''
      let tags: string[] = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
      let visibility: 'public' | 'private' | 'internal' = (opts.visibility as 'public' | 'private' | 'internal') ?? 'public'

      if (json) {
        // --json mode: error if slug is empty
        if (!slug) {
          console.error(JSON.stringify({
            error: 'INVALID_SLUG',
            message: 'Cannot generate a valid slug from the name. Use an ASCII name or specify --slug.',
            fix: `anpm create "${name}" --slug <slug> --description <description> --json`,
          }))
          process.exit(1)
        }
        // --json mode: error if required fields missing (no prompt)
        if (!opts.description) {
          console.error(JSON.stringify({
            error: 'MISSING_FIELD',
            message: 'Agent description is required.',
            fix: `anpm create ${name} --description <description> --json`,
            field: 'description',
          }))
          process.exit(1)
        }
        if (!opts.visibility) {
          console.error(JSON.stringify({
            error: 'MISSING_VISIBILITY',
            message: 'Select visibility.',
            fix: `anpm create ${name} --description "${description}" --visibility <visibility> --json`,
            options: [
              { value: 'public', label: 'Public — anyone can discover and install' },
              { value: 'private', label: 'Private — only authorized users with an access code' },
              { value: 'internal', label: 'Internal — anyone in the organization' },
            ],
          }))
          process.exit(1)
        }
        if (!['public', 'private', 'internal'].includes(opts.visibility)) {
          console.error(JSON.stringify({
            error: 'INVALID_FIELD',
            message: `Invalid visibility value: ${opts.visibility}`,
            fix: `visibility must be one of: public, private, internal.`,
            options: [
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
              { value: 'internal', label: 'Internal' },
            ],
          }))
          process.exit(1)
        }
      } else if (isTTY) {
        const { input: promptInput, select: promptSelect } = await import('@inquirer/prompts')

        console.log(`\n  \x1b[33m⚡\x1b[0m \x1b[1manpm create\x1b[0m — New agent project\n`)

        // If slug is empty (non-ASCII name), prompt for manual input
        if (!slug) {
          slug = await promptInput({
            message: 'Slug (URL-safe identifier for install):',
            validate: (v) => {
              const trimmed = v.trim()
              if (!trimmed) return 'Please enter a slug.'
              if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return 'Only lowercase letters, numbers, and hyphens allowed.'
              return true
            },
          })
          slug = slug.trim()
        }

        if (!description) {
          description = await promptInput({
            message: 'Agent description:',
            validate: (v) => v.trim().length > 0 ? true : 'Please enter a description.',
          })
        }

        if (!opts.tags) {
          const tagsRaw = await promptInput({
            message: 'Tags (comma-separated, optional):',
            default: '',
          })
          tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
        }

        if (!opts.visibility) {
          visibility = await promptSelect<'public' | 'private' | 'internal'>({
            message: 'Visibility:',
            choices: [
              { name: 'Public — anyone can discover and install', value: 'public' },
              { name: 'Private — only authorized users with an access code', value: 'private' },
              { name: 'Internal — anyone in the organization', value: 'internal' },
            ],
          })
        }
      }

      // 3. Auto-recommend recommended_scope
      //    rules/ exists or framework tag → local, otherwise → global
      const frameworkTags = ['nextjs', 'react', 'vue', 'angular', 'svelte', 'nuxt', 'remix', 'astro', 'django', 'rails', 'laravel', 'spring', 'express', 'fastapi', 'flask']
      const hasRules = fs.existsSync(path.join(projectPath, '.relay', 'rules'))
        || fs.existsSync(path.join(projectPath, 'rules'))
      const hasFrameworkTag = tags.some((t) => frameworkTags.includes(t.toLowerCase()))
      const recommendedScope: 'global' | 'local' = (hasRules || hasFrameworkTag) ? 'local' : 'global'

      // 4. Create .relay/relay.yaml
      fs.mkdirSync(relayDir, { recursive: true })
      const yamlData: Record<string, unknown> = {
        name,
        slug: slug,
        description,
        version: '1.0.0',
        type: 'hybrid',
        recommended_scope: recommendedScope,
        tags,
        visibility,
        contents: [],
      }
      fs.writeFileSync(relayYamlPath, yaml.dump(yamlData, { lineWidth: 120 }), 'utf-8')

      // 4. Create directory structure
      const createdDirs: string[] = []
      for (const dir of DEFAULT_DIRS) {
        const dirPath = path.join(projectPath, dir)
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
          createdDirs.push(dir)
        }
      }

      // 5. Install local Builder slash commands
      const detected = detectAgentCLIs(projectPath)
      const localResults: { tool: string; commands: string[] }[] = []

      for (const tool of detected) {
        const adapter = createAdapter(tool)
        const installed: string[] = []

        for (const cmd of BUILDER_COMMANDS) {
          const filePath = path.join(projectPath, adapter.getFilePath(cmd.id))
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, adapter.formatFile(cmd))
          installed.push(cmd.id)
        }

        localResults.push({ tool: tool.name, commands: installed })
      }

      // 6. Global User commands (install if absent)
      const globalInstalled = ensureGlobalUserCommands()

      // 7. Output
      if (json) {
        console.log(JSON.stringify({
          status: 'ok',
          name,
          slug: slug,
          recommended_scope: recommendedScope,
          anpm_yaml: 'created',
          directories: createdDirs,
          local_commands: localResults,
          global_commands: globalInstalled ? 'installed' : 'already',
        }))
      } else {
        const scopeLabel = recommendedScope === 'global' ? '\x1b[32mglobal\x1b[0m' : '\x1b[33mlocal\x1b[0m'
        const scopeReason = hasRules ? 'rules/ detected' : hasFrameworkTag ? 'framework tag detected' : 'general-purpose agent'
        console.log(`\n\x1b[32m✓ ${name} agent project created\x1b[0m\n`)
        console.log(`  .anpm/anpm.yaml created`)
        console.log(`  recommended_scope: ${scopeLabel} (${scopeReason})`)
        if (createdDirs.length > 0) {
          console.log(`  Directories created: ${createdDirs.join(', ')}`)
        }

        if (localResults.length > 0) {
          console.log(`\n  \x1b[36mBuilder commands (local)\x1b[0m`)
          for (const r of localResults) {
            console.log(`    ${r.tool}: ${r.commands.map((c) => `/${c}`).join(', ')}`)
          }
        }

        if (globalInstalled) {
          console.log(`\n  \x1b[36mUser commands (global)\x1b[0m — installed`)
        }

        console.log(`\n  Next steps: Publish to Space with \x1b[33m/anpm-create\x1b[0m`)
        console.log('  Restart your IDE to activate slash commands.\n')
      }
    })
}
