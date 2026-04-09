import path from 'path'
import { Command } from 'commander'
import {
  loadInstalled,
  saveInstalled,
  loadGlobalInstalled,
  saveGlobalInstalled,
} from '../lib/config.js'
import { isScopedSlug, parseSlug } from '../lib/slug.js'

export function registerDeployRecord(program: Command): void {
  program
    .command('deploy-record <slug>', { hidden: true })
    .description('Record deployed file info in installed.json')
    .requiredOption('--scope <scope>', 'Deploy scope (global or local)')
    .option('--files <paths...>', 'List of deployed file paths')
    .action((slugInput: string, opts: { scope: string; files?: string[] }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const scope = opts.scope

      if (scope !== 'global' && scope !== 'local') {
        const msg = { error: 'INVALID_SCOPE', message: '--scope must be global or local.' }
        if (json) {
          console.error(JSON.stringify(msg))
        } else {
          console.error(`\x1b[31mError:\x1b[0m ${msg.message}`)
        }
        process.exit(1)
      }

      const files = opts.files ?? []

      // Resolve absolute paths
      const resolvedFiles = files.map((f) =>
        f.startsWith('/') || f.startsWith('~')
          ? f
          : path.resolve(f)
      )

      // Find the agent in the appropriate registry
      const localRegistry = loadInstalled()
      const globalRegistry = loadGlobalInstalled()

      // Resolve slug — check both registries for short name match
      let slug: string
      if (isScopedSlug(slugInput)) {
        slug = slugInput
      } else {
        const allKeys = [...Object.keys(localRegistry), ...Object.keys(globalRegistry)]
        const match = allKeys.find((key) => {
          const parsed = parseSlug(key)
          return parsed && parsed.name === slugInput
        })
        slug = match ?? slugInput
      }

      // Check if agent exists in either registry
      const entry = localRegistry[slug] ?? globalRegistry[slug]
      if (!entry) {
        const msg = { error: 'NOT_INSTALLED', message: `'${slugInput}' is not installed.` }
        if (json) {
          console.error(JSON.stringify(msg))
        } else {
          console.error(`\x1b[31mError:\x1b[0m ${msg.message}`)
        }
        process.exit(1)
      }

      // Update deploy info
      entry.deploy_scope = scope as 'global' | 'local'
      entry.deployed_files = resolvedFiles

      // Save to the correct registry based on scope
      if (scope === 'global') {
        globalRegistry[slug] = entry
        saveGlobalInstalled(globalRegistry)
        // Also update local registry if entry exists there
        if (localRegistry[slug]) {
          localRegistry[slug] = entry
          saveInstalled(localRegistry)
        }
      } else {
        localRegistry[slug] = entry
        saveInstalled(localRegistry)
      }

      const result = {
        status: 'ok',
        slug,
        deploy_scope: scope,
        deployed_files: resolvedFiles.length,
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        const scopeLabel = scope === 'global' ? 'global' : 'local'
        console.log(`\x1b[32m✓ ${slug} deploy info recorded\x1b[0m (${scopeLabel}, ${resolvedFiles.length} files)`)
      }
    })
}
