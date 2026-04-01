import { execSync, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Git Binary Check ───

export function checkGitInstalled(): void {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' })
  } catch {
    throw new Error(
      'git이 설치되어 있지 않습니다.\n' +
      '  macOS: xcode-select --install\n' +
      '  Ubuntu/Debian: sudo apt install git\n' +
      '  Windows: https://git-scm.com/download/win'
    )
  }
}

// ─── Core Git Operations ───

export function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
}

export function gitClone(url: string, destDir: string, opts?: { depth?: number }): void {
  const args = ['clone']
  if (opts?.depth) {
    args.push('--depth', String(opts.depth))
  }
  args.push(url, destDir)
  execFileSync('git', args, { stdio: 'pipe' })
}

export function gitAdd(dir: string, files: string = '.'): void {
  execFileSync('git', ['add', files], { cwd: dir, stdio: 'pipe' })
}

export function gitCommit(dir: string, message: string): void {
  // Configure committer for the temp repo
  execFileSync('git', ['config', 'user.email', 'relay@relayax.com'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Relay CLI'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'pipe' })
}

export function gitTag(dir: string, tag: string): void {
  execFileSync('git', ['tag', tag], { cwd: dir, stdio: 'pipe' })
}

export function gitPush(dir: string, remote: string, refspec?: string): void {
  const args = ['push', remote]
  if (refspec) args.push(refspec)
  args.push('--tags')
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
}

export function gitFetch(dir: string): void {
  execFileSync('git', ['fetch', '--tags'], { cwd: dir, stdio: 'pipe' })
}

export function gitCheckout(dir: string, ref: string): void {
  execFileSync('git', ['checkout', ref], { cwd: dir, stdio: 'pipe' })
}

export function gitDiff(dir: string, from: string, to: string): string {
  return execFileSync('git', ['diff', `${from}..${to}`], {
    cwd: dir,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

export function gitLatestTag(dir: string): string | null {
  try {
    const result = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return result || null
  } catch {
    return null
  }
}

// ─── High-level Operations ───

/**
 * Build an authenticated git URL.
 * For public repos: https://git.relayax.com/@owner/agent.git
 * For gated/private: https://TOKEN:x@git.relayax.com/@owner/agent.git
 */
export function buildGitUrl(baseUrl: string, auth?: { token?: string; code?: string }): string {
  if (!auth?.token && !auth?.code) return baseUrl

  const url = new URL(baseUrl)
  const credential = auth.token ?? auth.code ?? ''
  url.username = credential
  url.password = 'x'
  return url.toString()
}

/**
 * First-time publish: init → add → commit → tag → push
 */
export async function gitPublishInit(
  sourceDir: string,
  remoteUrl: string,
  version: string,
): Promise<void> {
  gitInit(sourceDir)
  gitAdd(sourceDir)
  gitCommit(sourceDir, `v${version}`)
  gitTag(sourceDir, `v${version}`)
  gitPush(sourceDir, remoteUrl, 'HEAD:main')
}

/**
 * Re-publish: clone → replace files → commit → tag → push
 */
export async function gitPublishUpdate(
  sourceDir: string,
  remoteUrl: string,
  version: string,
): Promise<void> {
  const tempCloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-git-'))

  try {
    // Clone existing repo
    gitClone(remoteUrl, tempCloneDir)

    // Copy .git directory to source dir
    const gitDir = path.join(tempCloneDir, '.git')
    const destGitDir = path.join(sourceDir, '.git')
    fs.cpSync(gitDir, destGitDir, { recursive: true })

    // Add all files (including new/changed, removing deleted)
    gitAdd(sourceDir)
    gitCommit(sourceDir, `v${version}`)
    gitTag(sourceDir, `v${version}`)
    gitPush(sourceDir, 'origin')
  } finally {
    fs.rmSync(tempCloneDir, { recursive: true, force: true })
  }
}

/**
 * Install: git clone to destination, optionally checkout a specific version.
 */
export async function gitInstall(
  gitUrl: string,
  destDir: string,
  version?: string,
): Promise<void> {
  // Remove existing directory if present
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true })
  }
  fs.mkdirSync(path.dirname(destDir), { recursive: true })

  gitClone(gitUrl, destDir, { depth: 1 })

  if (version) {
    // Fetch all tags then checkout the specific version
    gitFetch(destDir)
    gitCheckout(destDir, `v${version}`)
  }
}

/**
 * Update: fetch latest then checkout the newest tag.
 */
export async function gitUpdate(destDir: string): Promise<string | null> {
  gitFetch(destDir)
  const latestTag = gitLatestTag(destDir)
  if (latestTag) {
    gitCheckout(destDir, latestTag)
  }
  return latestTag
}
