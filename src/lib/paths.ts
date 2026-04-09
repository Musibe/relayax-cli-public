import os from 'os'

/**
 * Resolve project root path.
 * Priority: --project option > RELAY_PROJECT_PATH env > process.cwd()
 */
export function resolveProjectPath(optProject?: string): string {
  return optProject ?? process.env.RELAY_PROJECT_PATH ?? process.cwd()
}

/**
 * Resolve home directory path.
 * Priority: --home option > RELAY_HOME env > os.homedir()
 */
export function resolveHome(optHome?: string): string {
  return optHome ?? process.env.RELAY_HOME ?? os.homedir()
}
