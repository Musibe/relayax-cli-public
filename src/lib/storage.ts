import fs from 'fs'
import os from 'os'
import { gitInstall } from './git-operations.js'

export function makeTempDir(): string {
  return fs.mkdtempSync(os.tmpdir() + '/relay-')
}

export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * Clone an agent from git URL to destination directory.
 */
export async function clonePackage(
  gitUrl: string,
  destDir: string,
  version?: string,
): Promise<void> {
  await gitInstall(gitUrl, destDir, version)
}
