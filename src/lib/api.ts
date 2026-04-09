import type { AgentRegistryInfo, SearchResult } from '../types.js'
import { API_URL, getValidToken } from './config.js'

export async function fetchMyOrgs(): Promise<{ id: string; slug: string; name: string; role: string }[]> {
  const token = await getValidToken()
  if (!token) return []
  const res = await fetch(`${API_URL}/api/orgs`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return []
  return res.json() as Promise<{ id: string; slug: string; name: string; role: string }[]>
}

export async function fetchAgentInfo(slug: string): Promise<AgentRegistryInfo> {
  const registrySlug = slug.startsWith('@') ? slug.slice(1) : slug
  const url = `${API_URL}/api/registry/${registrySlug}`
  const token = await getValidToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to fetch agent info (${res.status}): ${body}`)
  }
  return res.json() as Promise<AgentRegistryInfo>
}

export async function searchAgents(
  query: string,
  tag?: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query })
  if (tag) params.set('tag', tag)
  const url = `${API_URL}/api/registry/search?${params.toString()}`
  const token = await getValidToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Search failed (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { results: SearchResult[] }
  return data.results
}

export interface AgentVersionInfo {
  version: string
  changelog: string | null
  created_at: string
}

export async function fetchAgentVersions(slug: string): Promise<AgentVersionInfo[]> {
  const registrySlug = slug.startsWith('@') ? slug.slice(1) : slug
  const url = `${API_URL}/api/registry/${registrySlug}/versions`
  const token = await getValidToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to fetch versions (${res.status}): ${body}`)
  }
  return res.json() as Promise<AgentVersionInfo[]>
}

export async function reportInstall(agentId: string, slug: string, version?: string): Promise<void> {
  const url = `${API_URL}/api/agents/${agentId}/install`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const body: Record<string, string> = { slug }
  if (version) body.version = version

  const token = await getValidToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`\x1b[33m⚠ Failed to update install count (${res.status}): ${text}\x1b[0m`)
    }
  } catch {
    // network error: ignore silently
  }
}


export interface ResolvedSlug {
  owner: string
  name: string
  full: string  // "@owner/name"
}

export async function resolveSlugFromServer(name: string): Promise<ResolvedSlug[]> {
  const url = `${API_URL}/api/registry/resolve?name=${encodeURIComponent(name)}`
  const token = await getValidToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) {
    throw new Error(`Slug resolve failed (${res.status})`)
  }
  const data = (await res.json()) as { results: ResolvedSlug[] }
  return data.results
}

export async function sendUsagePing(agentId: string | null, slug: string, version?: string): Promise<void> {
  const { createHash } = await import('crypto')
  const { hostname, userInfo } = await import('os')
  const deviceHash = createHash('sha256')
    .update(`${hostname()}:${userInfo().username}`)
    .digest('hex')

  // CLI version
  const pkg = require('../../package.json') as { version: string }

  // Use UUID path if agentId exists, otherwise fall back to slug name
  const pathParam = agentId || slug.replace(/^@/, '').split('/').pop() || slug
  const url = `${API_URL}/api/agents/${pathParam}/ping`
  const payload: Record<string, string> = { device_hash: deviceHash, slug, cli_version: pkg.version }
  if (version) payload.installed_version = version

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getValidToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // fire-and-forget: ignore errors
  })
}

export async function followBuilder(username: string): Promise<void> {
  const token = await getValidToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`https://www.anpm.io/api/follows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ following_username: username, email_opt_in: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Follow failed (${res.status}): ${body}`)
  }
}
