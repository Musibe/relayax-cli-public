import { loadInstalled } from './config.js'
import { fetchTeamInfo, sendUsagePing } from './api.js'
import { isCacheValid, updateCacheTimestamp } from './update-cache.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

export interface UpdateResult {
  type: 'cli' | 'team'
  slug?: string
  current: string
  latest: string
  author?: string
}

export async function checkCliVersion(force?: boolean): Promise<UpdateResult | null> {
  if (isCacheValid('cli', force)) return null

  try {
    const res = await fetch('https://registry.npmjs.org/relayax-cli/latest', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version: string }
    updateCacheTimestamp('cli')

    if (data.version !== pkg.version) {
      return { type: 'cli', current: pkg.version, latest: data.version }
    }
  } catch {
    // network error — silently skip
  }
  return null
}

export async function checkTeamVersion(
  slug: string,
  force?: boolean
): Promise<UpdateResult | null> {
  if (isCacheValid(slug, force)) return null

  try {
    const installed = loadInstalled()
    const entry = installed[slug]
    if (!entry?.version) return null

    // system 타입(relay-core)은 CLI 버전 체크로 대체
    if (entry.type === 'system') {
      return null
    }

    const team = await fetchTeamInfo(slug)
    updateCacheTimestamp(slug)

    // Fire-and-forget usage ping (only when cache expired = actual API call happened)
    const teamId = entry.team_id ?? team.id
    if (teamId) {
      sendUsagePing(teamId, slug, entry.version)
    }

    if (team.version !== entry.version) {
      return {
        type: 'team',
        slug,
        current: entry.version,
        latest: team.version,
        author: team.author?.username,
      }
    }
  } catch {
    // network error — silently skip
  }
  return null
}

export async function checkAllTeams(force?: boolean): Promise<UpdateResult[]> {
  const installed = loadInstalled()
  const slugs = Object.keys(installed)
  const results: UpdateResult[] = []

  for (const slug of slugs) {
    const result = await checkTeamVersion(slug, force)
    if (result) results.push(result)
  }

  return results
}
