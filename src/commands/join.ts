import { Command } from 'commander'
import { getValidToken, API_URL } from '../lib/config.js'
import { hasGlobalUserCommands } from './init.js'

export async function joinOrg(orgSlug: string, code: string): Promise<{ type: string; role?: string }> {
  const token = await getValidToken()
  if (!token) {
    throw new Error('LOGIN_REQUIRED')
  }

  // Use the access code via API
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
        throw new Error('초대 코드가 유효하지 않거나 만료되었습니다.')
      default:
        throw new Error(body.message ?? `가입 실패 (${res.status})`)
    }
  }

  return res.json() as Promise<{ type: string; role?: string }>
}

export function registerJoin(program: Command): void {
  program
    .command('join <slug>')
    .description('Organization에 초대 코드로 가입합니다')
    .requiredOption('--code <code>', '초대 코드 (UUID)')
    .action(async (slug: string, opts: { code: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      if (!hasGlobalUserCommands()) {
        if (!json) {
          console.error('\x1b[33m⚠ relay init이 실행되지 않았습니다. 먼저 relay init을 실행하세요.\x1b[0m')
        } else {
          console.error(JSON.stringify({ error: 'NOT_INITIALIZED', message: 'relay init을 먼저 실행하세요.', fix: 'relay init 실행하세요.' }))
        }
        process.exit(1)
      }

      try {
        const result = await joinOrg(slug, opts.code)

        if (json) {
          console.log(JSON.stringify({ status: 'ok', ...result }))
        } else {
          if (result.type === 'org') {
            console.log(`\x1b[32m✅ @${slug} Organization에 가입했습니다 (역할: ${result.role ?? 'member'})\x1b[0m`)
            console.log(`\n\x1b[33m  대시보드: www.relayax.com/orgs/${slug}\x1b[0m`)
          } else {
            console.log(`\x1b[32m✅ 에이전트 접근 권한이 부여되었습니다\x1b[0m`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        if (message === 'LOGIN_REQUIRED') {
          if (json) {
            console.error(JSON.stringify({
              error: 'LOGIN_REQUIRED',
              message: '로그인이 필요합니다. relay login 을 먼저 실행하세요.',
              fix: 'relay login 실행 후 재시도하세요.',
            }))
          } else {
            console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
            console.error('  relay login 을 먼저 실행하세요.')
          }
          process.exit(1)
        }

        if (json) {
          console.error(JSON.stringify({ error: 'JOIN_FAILED', message, fix: 'slug와 초대 코드를 확인 후 재시도하세요.' }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
