import fs from 'fs'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { loadInstalled, saveInstalled, loadGlobalInstalled, saveGlobalInstalled } from '../lib/config.js'
import { resolveProjectPath } from '../lib/paths.js'
import { deploySymlinks } from '../lib/installer.js'
import { findUnmanagedContent } from '../lib/agent-status.js'

export function registerAdopt(program: Command): void {
  program
    .command('adopt [path]', { hidden: true })
    .description('Adopt unmanaged skills into anpm management')
    .option('--all', 'Adopt all unmanaged skills')
    .option('--global', 'Adopt to global scope')
    .option('--project <dir>', 'Project root path')
    .option('--yes', 'Skip confirmation prompts')
    .action(async (inputPath: string | undefined, opts: { all?: boolean; global?: boolean; project?: string; yes?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const scope: 'global' | 'local' = opts.global ? 'global' : 'local'

      try {
        if (opts.all) {
          // Adopt all unmanaged content
          const unmanaged = findUnmanagedContent(projectPath)
          if (unmanaged.length === 0) {
            if (json) console.log(JSON.stringify({ status: 'ok', message: 'All content is already managed by anpm' }))
            else console.log('\x1b[32m✓\x1b[0m All content is already managed by anpm.')
            return
          }

          if (!json) {
            console.log(`\nFound ${unmanaged.length} unmanaged item(s):\n`)
            for (const item of unmanaged) {
              console.log(`  ${item.type}/${item.name}  \x1b[90m(${item.harness})\x1b[0m`)
            }
          }

          if (!opts.yes && !json) {
            const { confirm } = await import('@inquirer/prompts')
            const ok = await confirm({ message: `Adopt all ${unmanaged.length} items?`, default: true })
            if (!ok) { process.exit(0) }
          }

          let adopted = 0
          for (const item of unmanaged) {
            try {
              await adoptSingle(item.path, item.name, scope, projectPath, json)
              adopted++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (!json) console.error(`  \x1b[33m⚠️ Skipping ${item.name}: ${msg}\x1b[0m`)
            }
          }

          if (json) console.log(JSON.stringify({ status: 'ok', adopted }))
          else console.log(`\n\x1b[32m✓\x1b[0m Adopted ${adopted} item(s).`)
          return
        }

        // Single path adopt
        if (!inputPath) {
          console.error('Usage: anpm adopt <path> or anpm adopt --all')
          process.exit(1)
        }

        const absPath = path.resolve(inputPath)
        if (!fs.existsSync(absPath)) {
          throw new Error(`Path not found: ${absPath}`)
        }

        // Check if already a relay symlink
        try {
          if (fs.lstatSync(absPath).isSymbolicLink()) {
            const target = fs.readlinkSync(absPath)
            if (target.includes('.relay/agents/')) {
              if (json) console.log(JSON.stringify({ status: 'ok', message: 'Already managed by anpm' }))
              else console.log(`\x1b[32m✓\x1b[0m Already managed by anpm.`)
              return
            }
          }
        } catch { /* not a symlink */ }

        const name = path.basename(absPath)
        await adoptSingle(absPath, name, scope, projectPath, json)

        if (json) {
          console.log(JSON.stringify({ status: 'ok', slug: `adopted/${name}` }))
        } else {
          console.log(`\n\x1b[32m✓ Adopted ${name}\x1b[0m`)
          console.log(`  Now managed by anpm and deployed to all detected harnesses.`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) console.error(JSON.stringify({ error: 'ADOPT_FAILED', message }))
        else console.error(`\x1b[31m✖ ${message}\x1b[0m`)
        process.exit(1)
      }
    })
}

async function adoptSingle(
  sourcePath: string,
  name: string,
  scope: 'global' | 'local',
  projectPath: string,
  json: boolean,
): Promise<void> {
  const baseDir = scope === 'global'
    ? path.join(os.homedir(), '.relay', 'agents', 'local', name)
    : path.join(projectPath, '.relay', 'agents', 'local', name)

  // Detect what type of content this is (skill, command, rule)
  // by looking at the parent directory name
  const parentDir = path.basename(path.dirname(sourcePath))
  const contentType = ['skills', 'commands', 'rules', 'agents'].includes(parentDir) ? parentDir : 'skills'

  const destDir = path.join(baseDir, contentType, name)

  // Safety: copy first, then symlink, then delete original
  // 1. Copy to .relay/agents/
  fs.mkdirSync(destDir, { recursive: true })
  copyDirRecursive(sourcePath, destDir)

  // 2. Verify copy exists
  if (!fs.existsSync(destDir)) {
    throw new Error(`Copy failed: ${destDir}`)
  }

  // 3. Remove original and replace with symlink
  if (fs.lstatSync(sourcePath).isDirectory()) {
    fs.rmSync(sourcePath, { recursive: true, force: true })
  } else {
    fs.unlinkSync(sourcePath)
  }
  const relativeSrc = path.relative(path.dirname(sourcePath), destDir)
  fs.symlinkSync(relativeSrc, sourcePath)

  // 4. Deploy to other harnesses
  const deploy = await deploySymlinks(baseDir, scope, projectPath)
  for (const w of deploy.warnings) {
    if (!json) console.error(`\x1b[33m${w}\x1b[0m`)
  }

  // 5. Record in installed.json
  const slug = `adopted/${name}`
  const record = {
    version: '0.0.0',
    installed_at: new Date().toISOString(),
    files: [baseDir],
    deploy_scope: scope,
    deployed_symlinks: [sourcePath, ...deploy.symlinks],
    source: `adopted:${sourcePath}`,
  }

  if (scope === 'global') {
    const installed = loadGlobalInstalled()
    installed[slug] = record
    saveGlobalInstalled(installed)
  } else {
    const installed = loadInstalled()
    installed[slug] = record
    saveInstalled(installed)
  }
}

function copyDirRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      copyDirRecursive(path.join(src, entry.name), path.join(dest, entry.name))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}
