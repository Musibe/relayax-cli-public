import path from 'path'
import { Command } from 'commander'
import { loadInstalled, saveInstalled, loadGlobalInstalled, saveGlobalInstalled } from '../lib/config.js'
import { resolveProjectPath } from '../lib/paths.js'
import { deploySymlinks, removeSymlinks } from '../lib/installer.js'
import { detectAgentStructure, hasDetectedContent, formatDetectedStructure } from '../lib/auto-detect.js'

export function registerLink(program: Command): void {
  program
    .command('link [path]')
    .description('Link a local agent directory to harnesses for development')
    .option('--global', 'Link globally (home directory)')
    .option('--project <dir>', 'Project root path')
    .action(async (inputPath: string | undefined, opts: { global?: boolean; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const sourcePath = inputPath ? path.resolve(inputPath) : process.cwd()
      const scope: 'global' | 'local' = opts.global ? 'global' : 'local'

      try {
        const detected = detectAgentStructure(sourcePath)
        if (!hasDetectedContent(detected)) {
          const msg = `No agent structure detected in ${sourcePath}`
          if (json) console.error(JSON.stringify({ error: 'NO_STRUCTURE', message: msg }))
          else console.error(`\x1b[31m✖ ${msg}\x1b[0m`)
          process.exit(1)
        }

        const name = path.basename(sourcePath)
        // Link directly — deploySymlinks creates symlinks pointing to sourcePath
        const deploy = await deploySymlinks(sourcePath, scope, projectPath)

        const slug = `link/${name}`
        const installRecord = {
          version: '0.0.0',
          installed_at: new Date().toISOString(),
          files: [sourcePath],
          deploy_scope: scope,
          deployed_symlinks: deploy.symlinks,
          source: `link:${sourcePath}`,
        }

        if (scope === 'global') {
          const installed = loadGlobalInstalled()
          installed[slug] = installRecord
          saveGlobalInstalled(installed)
        } else {
          const installed = loadInstalled()
          installed[slug] = installRecord
          saveInstalled(installed)
        }

        if (json) {
          console.log(JSON.stringify({ status: 'ok', slug, source: sourcePath, symlinks: deploy.symlinks }))
        } else {
          console.log(`\n\x1b[32m✓ Linked ${name}\x1b[0m`)
          console.log(`  source: \x1b[36m${sourcePath}\x1b[0m`)
          console.log(`  symlinks: ${deploy.symlinks.length}`)
          if (detected.method !== 'relay-yaml') {
            console.error(`  detected (${detected.method}):`)
            console.error(formatDetectedStructure(detected))
          }
          console.log(`\n\x1b[33mChanges to source files will be reflected immediately.\x1b[0m`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) console.error(JSON.stringify({ error: 'LINK_FAILED', message }))
        else console.error(`\x1b[31m✖ ${message}\x1b[0m`)
        process.exit(1)
      }
    })

  program
    .command('unlink <name>')
    .description('Remove a linked agent from harnesses')
    .action(async (name: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const slug = name.startsWith('link/') ? name : `link/${name}`

      // Check both global and local
      const globalInstalled = loadGlobalInstalled()
      const localInstalled = loadInstalled()
      const entry = globalInstalled[slug] ?? localInstalled[slug]

      if (!entry) {
        const msg = `No linked agent found: ${name}`
        if (json) console.error(JSON.stringify({ error: 'NOT_FOUND', message: msg }))
        else console.error(`\x1b[31m✖ ${msg}\x1b[0m`)
        process.exit(1)
      }

      const removed = removeSymlinks(entry.deployed_symlinks ?? [])

      if (globalInstalled[slug]) {
        delete globalInstalled[slug]
        saveGlobalInstalled(globalInstalled)
      }
      if (localInstalled[slug]) {
        delete localInstalled[slug]
        saveInstalled(localInstalled)
      }

      if (json) {
        console.log(JSON.stringify({ status: 'ok', slug, removed: removed.length }))
      } else {
        console.log(`\x1b[32m✓ Unlinked ${name}\x1b[0m (${removed.length} symlinks removed)`)
      }
    })
}
