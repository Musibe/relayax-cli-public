import { loadInstalled } from './config.js'
import { fetchAgentInfo, sendUsagePing } from './api.js'
import { isCacheValid, updateCacheTimestamp } from './update-cache.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

export interface UpdateResult {
  type: 'cli' | 'agent'
  slug?: string
  current: string
  latest: string
  author?: string
}

export async function checkCliVersion(force?: boolean): Promise<UpdateResult | null> {
  if (isCacheValid('cli', force)) return null

  try {
    const res = await fetch('https://registry.npmjs.org/anpm-io/latest', {
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

export async function checkAgentVersion(
  slug: string,
  force?: boolean
): Promise<UpdateResult | null> {
  if (isCacheValid(slug, force)) return null

  try {
    const installed = loadInstalled()
    const entry = installed[slug]
    if (!entry?.version) return null

    // system type (relay-core) uses CLI version check instead
    if (entry.type === 'system') {
      return null
    }

    const agent = await fetchAgentInfo(slug)
    updateCacheTimestamp(slug)

    // Fire-and-forget usage ping (only when cache expired = actual API call happened)
    const agentId = entry.agent_id ?? agent.id
    if (agentId) {
      sendUsagePing(agentId, slug, entry.version)
    }

    if (agent.version !== entry.version) {
      return {
        type: 'agent',
        slug,
        current: entry.version,
        latest: agent.version,
        author: agent.author?.username,
      }
    }
  } catch {
    // network error — silently skip
  }
  return null
}

export async function checkAllAgents(force?: boolean): Promise<UpdateResult[]> {
  const installed = loadInstalled()
  const slugs = Object.keys(installed)
  const results: UpdateResult[] = []

  for (const slug of slugs) {
    const result = await checkAgentVersion(slug, force)
    if (result) results.push(result)
  }

  return results
}
