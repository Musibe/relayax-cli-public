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
        throw new Error('접근 코드가 유효하지 않거나 만료되었습니다.')
      default:
        throw new Error(body.message ?? `접근 코드 사용 실패 (${res.status})`)
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
    throw new Error(body.message ?? `접근 코드 생성 실패 (${res.status})`)
  }

  return res.json() as Promise<CreateAccessCodeResult>
}

function ensureInit(json: boolean): void {
  if (!hasGlobalUserCommands()) {
    if (json) {
      console.error(JSON.stringify({ error: 'NOT_INITIALIZED', message: 'anpm init을 먼저 실행하세요.', fix: 'anpm init 실행하세요.' }))
    } else {
      console.error('\x1b[33m⚠ anpm init이 실행되지 않았습니다. 먼저 anpm init을 실행하세요.\x1b[0m')
    }
    process.exit(1)
  }
}

function handleError(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err)

  if (message === 'LOGIN_REQUIRED') {
    if (json) {
      console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', fix: 'anpm login 실행 후 재시도하세요.' }))
    } else {
      console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
      console.error('  anpm login 을 먼저 실행하세요.')
    }
    process.exit(1)
  }

  if (json) {
    console.error(JSON.stringify({ error: 'GRANT_FAILED', message, fix: '접근 코드를 확인 후 재시도하세요.' }))
  } else {
    console.error(`\x1b[31m오류: ${message}\x1b[0m`)
  }
  process.exit(1)
}

export function registerGrant(program: Command): void {
  const grant = program
    .command('grant')
    .description('접근 코드를 사용하거나 생성합니다')

  // relay grant --code <code>  (use an access code)
  grant
    .command('use')
    .description('접근 코드를 사용하여 org 가입 또는 에이전트 접근 권한을 획득합니다')
    .requiredOption('--code <code>', '접근 코드')
    .action(async (opts: { code: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      ensureInit(json)

      try {
        const result = await useAccessCode(opts.code)

        if (json) {
          console.log(JSON.stringify({ ...result, status: 'ok' }))
        } else {
          if (result.type === 'org') {
            console.log(`\x1b[32m✅ Organization에 가입했습니다 (역할: ${result.role ?? 'member'})\x1b[0m`)
          } else {
            console.log(`\x1b[32m✅ 에이전트 접근 권한이 부여되었습니다\x1b[0m`)
          }
        }
      } catch (err) {
        handleError(err, json)
      }
    })

  // relay grant create --agent <slug> [--max-uses N] [--expires-at DATE]
  grant
    .command('create')
    .description('에이전트 또는 org의 접근 코드를 생성합니다')
    .option('--agent <slug>', '에이전트 slug')
    .option('--org <slug>', 'Organization slug')
    .option('--max-uses <n>', '최대 사용 횟수', parseInt)
    .option('--expires-at <date>', '만료일 (ISO 8601)')
    .action(async (opts: { agent?: string; org?: string; maxUses?: number; expiresAt?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      ensureInit(json)

      if (!opts.agent && !opts.org) {
        const msg = '--agent 또는 --org 옵션이 필요합니다.'
        if (json) {
          console.error(JSON.stringify({ error: 'MISSING_OPTION', message: msg }))
        } else {
          console.error(`\x1b[31m오류: ${msg}\x1b[0m`)
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
          if (!res.ok) throw new Error('에이전트를 찾을 수 없습니다.')
          const agent = await res.json() as { id: string }
          agentId = agent.id
        }

        if (opts.org) {
          const res = await fetch(`${API_URL}/api/orgs/${opts.org}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error('Organization을 찾을 수 없습니다.')
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
          console.log(`\x1b[32m✅ 접근 코드가 생성되었습니다\x1b[0m`)
          console.log(`\n  코드: \x1b[36m${result.code}\x1b[0m`)
          if (result.max_uses) console.log(`  최대 사용: ${result.max_uses}회`)
          if (result.expires_at) console.log(`  만료: ${new Date(result.expires_at).toLocaleDateString('ko-KR')}`)
          console.log(`\n  \x1b[90m사용 방법: anpm grant use --code ${result.code}\x1b[0m`)
        }
      } catch (err) {
        handleError(err, json)
      }
    })
}
