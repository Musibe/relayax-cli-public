import type { TeamRegistryInfo, SearchResult } from '../types.js'
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

export async function fetchTeamInfo(slug: string): Promise<TeamRegistryInfo> {
  const registrySlug = slug.startsWith('@') ? slug.slice(1) : slug
  const url = `${API_URL}/api/registry/${registrySlug}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`팀 정보 조회 실패 (${res.status}): ${body}`)
  }
  return res.json() as Promise<TeamRegistryInfo>
}

export async function searchTeams(
  query: string,
  tag?: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query })
  if (tag) params.set('tag', tag)
  const url = `${API_URL}/api/registry/search?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`검색 실패 (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { results: SearchResult[] }
  return data.results
}

export interface TeamVersionInfo {
  version: string
  changelog: string | null
  created_at: string
}

export async function fetchTeamVersions(slug: string): Promise<TeamVersionInfo[]> {
  const registrySlug = slug.startsWith('@') ? slug.slice(1) : slug
  const url = `${API_URL}/api/registry/${registrySlug}/versions`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`버전 목록 조회 실패 (${res.status}): ${body}`)
  }
  return res.json() as Promise<TeamVersionInfo[]>
}

export async function reportInstall(teamId: string, slug: string, version?: string): Promise<void> {
  const url = `${API_URL}/api/teams/${teamId}/install`
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
      console.error(`\x1b[33m⚠ 설치 카운트 업데이트 실패 (${res.status}): ${text}\x1b[0m`)
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
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) {
    throw new Error(`slug resolve 실패 (${res.status})`)
  }
  const data = (await res.json()) as { results: ResolvedSlug[] }
  return data.results
}

export async function sendUsagePing(teamId: string, slug: string, version?: string): Promise<void> {
  const { createHash } = await import('crypto')
  const { hostname, userInfo } = await import('os')
  const deviceHash = createHash('sha256')
    .update(`${hostname()}:${userInfo().username}`)
    .digest('hex')

  const url = `${API_URL}/api/teams/${teamId}/ping`
  const payload: Record<string, string> = { device_hash: deviceHash, slug }
  if (version) payload.installed_version = version

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getValidToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
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
  const res = await fetch(`https://www.relayax.com/api/follows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ following_username: username, email_opt_in: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`팔로우 실패 (${res.status}): ${body}`)
  }
}
