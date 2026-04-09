import fs from 'fs'
import path from 'path'
import os from 'os'

const MIGRATION_FILES = ['token', 'config.json', 'installed.json']

/**
 * Migrate ~/.relay/ → ~/.anpm/ on first run.
 * Copies token, config.json, installed.json if ~/.anpm/ doesn't exist.
 */
export function migrateGlobalDir(): void {
  const home = process.env.ANPM_HOME ?? process.env.RELAY_HOME ?? os.homedir()
  const anpmDir = path.join(home, '.anpm')
  const relayDir = path.join(home, '.relay')

  if (fs.existsSync(anpmDir)) return
  if (!fs.existsSync(relayDir)) return

  try {
    fs.mkdirSync(anpmDir, { recursive: true })

    for (const file of MIGRATION_FILES) {
      const src = path.join(relayDir, file)
      const dst = path.join(anpmDir, file)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst)
        if (file === 'token') {
          fs.chmodSync(dst, 0o600)
        }
      }
    }

    // Copy agents directory if exists
    const agentsSrc = path.join(relayDir, 'agents')
    const agentsDst = path.join(anpmDir, 'agents')
    if (fs.existsSync(agentsSrc) && !fs.existsSync(agentsDst)) {
      copyDirRecursive(agentsSrc, agentsDst)
    }

    process.stderr.write('\x1b[32m✓\x1b[0m Migrated settings from ~/.relay/ to ~/.anpm/\n')
  } catch {
    // Non-fatal
  }
}

/**
 * Migrate project-level .relay/ → .anpm/ and relay.yaml → anpm.yaml.
 * Auto-renames in place.
 */
export function migrateProjectDir(projectPath: string): void {
  try {
    // .relay/ → .anpm/
    const relayDir = path.join(projectPath, '.relay')
    const anpmDir = path.join(projectPath, '.anpm')
    if (fs.existsSync(relayDir) && !fs.existsSync(anpmDir)) {
      fs.renameSync(relayDir, anpmDir)
      process.stderr.write(`\x1b[32m✓\x1b[0m Renamed .relay/ → .anpm/\n`)
    }

    // relay.yaml → anpm.yaml
    const relayYaml = path.join(projectPath, 'relay.yaml')
    const anpmYaml = path.join(projectPath, 'anpm.yaml')
    if (fs.existsSync(relayYaml) && !fs.existsSync(anpmYaml)) {
      fs.renameSync(relayYaml, anpmYaml)
      process.stderr.write(`\x1b[32m✓\x1b[0m Renamed relay.yaml → anpm.yaml\n`)
    }

    // .relay/relay.yaml → .anpm/anpm.yaml (nested)
    const nestedRelay = path.join(anpmDir, 'relay.yaml')
    const nestedAnpm = path.join(anpmDir, 'anpm.yaml')
    if (fs.existsSync(nestedRelay) && !fs.existsSync(nestedAnpm)) {
      fs.renameSync(nestedRelay, nestedAnpm)
    }
  } catch {
    // Non-fatal
  }
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const dstPath = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath)
    } else {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}
