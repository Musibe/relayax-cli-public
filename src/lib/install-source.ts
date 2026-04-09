import path from 'path'

// ─── Install Source Types ───

export interface RegistrySource {
  type: 'registry'
  slug: string
}

export interface LocalSource {
  type: 'local'
  absolutePath: string
  name: string
}

export interface GitSource {
  type: 'git'
  url: string
  ref?: string
  host: string
  user: string
  repo: string
  subpath?: string
}

export type InstallSource = RegistrySource | LocalSource | GitSource

// ─── Git URL Parsing ───

const GIT_PREFIXES: Record<string, string> = {
  'github:': 'https://github.com/',
  'gitlab:': 'https://gitlab.com/',
  'bitbucket:': 'https://bitbucket.org/',
}

/**
 * Parse a git shorthand (github:user/repo#ref) into a GitSource.
 */
export function parseGitUrl(input: string): GitSource {
  for (const [prefix, baseUrl] of Object.entries(GIT_PREFIXES)) {
    if (input.startsWith(prefix)) {
      const rest = input.slice(prefix.length)
      const [pathPart, ref] = rest.split('#', 2)
      const [user, repo] = pathPart.split('/', 2)
      if (!user || !repo) throw new Error(`Invalid git URL: ${input}`)
      return {
        type: 'git',
        url: `${baseUrl}${user}/${repo}.git`,
        ref: ref || undefined,
        host: prefix.replace(':', ''),
        user,
        repo,
      }
    }
  }

  // Full HTTPS git URL: https://github.com/user/repo.git
  if (input.startsWith('https://') && input.endsWith('.git')) {
    const url = new URL(input)
    const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    const user = parts[0] || 'unknown'
    const repo = parts[1] || 'unknown'
    return {
      type: 'git',
      url: input,
      host: url.hostname.split('.')[0],
      user,
      repo,
    }
  }

  // Full HTTPS without .git: https://github.com/user/repo
  if (input.startsWith('https://')) {
    const url = new URL(input)
    const parts = url.pathname.replace(/^\//, '').split('/')
    const user = parts[0] || 'unknown'
    const repo = parts[1] || 'unknown'
    return {
      type: 'git',
      url: `${input}.git`,
      host: url.hostname.split('.')[0],
      user,
      repo,
    }
  }

  throw new Error(`Cannot parse git URL: ${input}`)
}

// ─── Source Detection ───

/**
 * Parse install input to determine the source type.
 *
 * Rules:
 * 1. Starts with ./ ../ / ~/ → local
 * 2. Starts with github: gitlab: bitbucket: → git
 * 3. Starts with https:// → git
 * 4. Everything else (owner/name) → registry
 */
export function parseInstallSource(input: string): InstallSource {
  // Local path detection
  if (input.startsWith('./') || input.startsWith('../') || input.startsWith('/') || input.startsWith('~/')) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
    const resolved = input.startsWith('~/')
      ? path.join(homeDir, input.slice(2))
      : path.resolve(input)
    const name = path.basename(resolved)
    return { type: 'local', absolutePath: resolved, name }
  }

  // Git shorthand detection
  for (const prefix of Object.keys(GIT_PREFIXES)) {
    if (input.startsWith(prefix)) {
      return parseGitUrl(input)
    }
  }

  // Full HTTPS URL
  if (input.startsWith('https://')) {
    return parseGitUrl(input)
  }

  // Default: registry
  return { type: 'registry', slug: input }
}
