import { Command } from 'commander'
import { getValidToken, API_URL } from '../lib/config.js'

interface ClaimAccessResponse {
  success?: boolean
  team?: { slug: string; name: string }
  error?: string
  message?: string
}

async function claimAccess(slug: string, code: string): Promise<ClaimAccessResponse> {
  const token = await getValidToken()
  if (!token) {
    throw new Error('LOGIN_REQUIRED')
  }

  const res = await fetch(`${API_URL}/api/teams/${slug}/claim-access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(10000),
  })

  const body = (await res.json().catch(() => ({}))) as ClaimAccessResponse

  if (!res.ok) {
    const errCode = body.error ?? String(res.status)
    switch (errCode) {
      case 'INVALID_LINK':
        throw new Error('초대 링크가 유효하지 않거나 만료되었습니다.')
      case 'NOT_FOUND':
        throw new Error('팀을 찾을 수 없습니다.')
      case 'UNAUTHORIZED':
        throw new Error('LOGIN_REQUIRED')
      default:
        throw new Error(body.message ?? `접근 권한 요청 실패 (${res.status})`)
    }
  }

  return body
}

export function registerAccess(program: Command): void {
  program
    .command('access <slug>')
    .description('초대 코드로 팀에 접근 권한을 얻고 바로 설치합니다')
    .requiredOption('--code <code>', '팀 초대 코드')
    .action(async (slug: string, opts: { code: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      try {
        const result = await claimAccess(slug, opts.code)

        if (!result.success || !result.team) {
          throw new Error('서버 응답이 올바르지 않습니다.')
        }

        const teamSlug = result.team.slug

        if (json) {
          console.log(JSON.stringify({ status: 'ok', team: result.team }))
        } else {
          console.log(`\x1b[32m접근 권한이 부여되었습니다: ${result.team.name}\x1b[0m`)
          console.log(`\x1b[33m팀을 설치합니다: relay install ${teamSlug}\x1b[0m\n`)
        }

        // Automatically install the team
        const { registerInstall } = await import('./install.js')
        const subProgram = new Command()
        subProgram.option('--json', '구조화된 JSON 출력')
        if (json) subProgram.setOptionValue('json', true)
        registerInstall(subProgram)

        await subProgram.parseAsync(['node', 'relay', 'install', teamSlug])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        if (message === 'LOGIN_REQUIRED') {
          if (json) {
            console.error(JSON.stringify({
              error: 'LOGIN_REQUIRED',
              message: '로그인이 필요합니다. relay login을 먼저 실행하세요.',
              fix: 'relay login 실행 후 재시도하세요.',
            }))
          } else {
            console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
            console.error('  relay login을 먼저 실행하세요.')
          }
          process.exit(1)
        }

        if (json) {
          console.error(JSON.stringify({ error: 'ACCESS_FAILED', message, fix: '접근 링크 코드를 확인하거나 팀 제작자에게 문의하세요.' }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
