import { Command } from 'commander'
import { getValidToken, API_URL } from '../lib/config.js'
import { hasGlobalUserCommands } from './init.js'

interface AccessCodeResult {
  status: string
  type: 'org' | 'agent'
  org_id?: string
  agent_id?: string
  role?: string
}

/**
 * Use an access code — the code type (org/agent) is resolved server-side.
 * For org codes: joins the org as member.
 * For agent codes: grants agent access (+ auto org join for org private agents).
 */
export async function useAccessCode(code: string): Promise<AccessCodeResult> {
  const token = await getValidToken()
  if (!token) {
    throw new Error('LOGIN_REQUIRED')
  }

  const res = await fetch(`${API_URL}/api/access-codes/${code}/use`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string }
    const errCode = body.error ?? String(res.status)
    switch (errCode) {
      case 'INVALID_LINK':
        throw new Error('Access code is invalid or expired.')
      default:
        throw new Error(body.message ?? `Failed to use access code (${res.status})`)
    }
  }

  return res.json() as Promise<AccessCodeResult>
}

interface CreateAccessCodeResult {
  id: string
  code: string
  type: string
  max_uses: number | null
  expires_at: string | null
}

/**
 * Create a new access code for an agent or org.
 */
export async function createAccessCode(opts: {
  type: 'org' | 'agent'
  org_id?: string
  agent_id?: string
  max_uses?: number
  expires_at?: string
}): Promise<CreateAccessCodeResult> {
  const token = await getValidToken()
  if (!token) {
    throw new Error('LOGIN_REQUIRED')
  }

  const res = await fetch(`${API_URL}/api/access-codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(opts),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? `Failed to create access code (${res.status})`)
  }

  return res.json() as Promise<CreateAccessCodeResult>
}

function ensureInit(json: boolean): void {
  if (!hasGlobalUserCommands()) {
    if (json) {
      console.error(JSON.stringify({ error: 'NOT_INITIALIZED', message: 'Run anpm init first.', fix: 'Run anpm init.' }))
    } else {
      console.error('\x1b[33m⚠ anpm init has not been run. Please run anpm init first.\x1b[0m')
    }
    process.exit(1)
  }
}

function handleError(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err)

  if (message === 'LOGIN_REQUIRED') {
    if (json) {
      console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: 'Authentication required.', fix: 'Run anpm login and try again.' }))
    } else {
      console.error('\x1b[31mError: Authentication required.\x1b[0m')
      console.error('  Run anpm login first.')
    }
    process.exit(1)
  }

  if (json) {
    console.error(JSON.stringify({ error: 'GRANT_FAILED', message, fix: 'Check the access code and try again.' }))
  } else {
    console.error(`\x1b[31mError: ${message}\x1b[0m`)
  }
  process.exit(1)
}

export function registerGrant(program: Command): void {
  const grant = program
    .command('grant')
    .description('Use or create access codes')

  // relay grant --code <code>  (use an access code)
  grant
    .command('use')
    .description('Use an access code to join an org or gain agent access')
    .requiredOption('--code <code>', 'Access code')
    .action(async (opts: { code: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      ensureInit(json)

      try {
        const result = await useAccessCode(opts.code)

        if (json) {
          console.log(JSON.stringify({ ...result, status: 'ok' }))
        } else {
          if (result.type === 'org') {
            console.log(`\x1b[32m✅ Joined organization (role: ${result.role ?? 'member'})\x1b[0m`)
          } else {
            console.log(`\x1b[32m✅ Agent access granted\x1b[0m`)
          }
        }
      } catch (err) {
        handleError(err, json)
      }
    })

  // relay grant create --agent <slug> [--max-uses N] [--expires-at DATE]
  grant
    .command('create')
    .description('Create an access code for an agent or org')
    .option('--agent <slug>', 'Agent slug')
    .option('--org <slug>', 'Organization slug')
    .option('--max-uses <n>', 'Maximum number of uses', parseInt)
    .option('--expires-at <date>', 'Expiration date (ISO 8601)')
    .action(async (opts: { agent?: string; org?: string; maxUses?: number; expiresAt?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      ensureInit(json)

      if (!opts.agent && !opts.org) {
        const msg = '--agent or --org option is required.'
        if (json) {
          console.error(JSON.stringify({ error: 'MISSING_OPTION', message: msg }))
        } else {
          console.error(`\x1b[31mError: ${msg}\x1b[0m`)
        }
        process.exit(1)
      }

      try {
        const token = await getValidToken()
        if (!token) throw new Error('LOGIN_REQUIRED')

        // Resolve agent/org ID from slug
        let agentId: string | undefined
        let orgId: string | undefined

        if (opts.agent) {
          const res = await fetch(`${API_URL}/api/agents/${opts.agent}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error('Agent not found.')
          const agent = await res.json() as { id: string }
          agentId = agent.id
        }

        if (opts.org) {
          const res = await fetch(`${API_URL}/api/orgs/${opts.org}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error('Organization not found.')
          const org = await res.json() as { id: string }
          orgId = org.id
        }

        const result = await createAccessCode({
          type: agentId ? 'agent' : 'org',
          agent_id: agentId,
          org_id: orgId,
          max_uses: opts.maxUses,
          expires_at: opts.expiresAt,
        })

        if (json) {
          console.log(JSON.stringify({ status: 'created', ...result }))
        } else {
          console.log(`\x1b[32m✅ Access code created\x1b[0m`)
          console.log(`\n  Code: \x1b[36m${result.code}\x1b[0m`)
          if (result.max_uses) console.log(`  Max uses: ${result.max_uses}`)
          if (result.expires_at) console.log(`  Expires: ${new Date(result.expires_at).toLocaleDateString('en-US')}`)
          console.log(`\n  \x1b[90mUsage: anpm grant use --code ${result.code}\x1b[0m`)
        }
      } catch (err) {
        handleError(err, json)
      }
    })
}
