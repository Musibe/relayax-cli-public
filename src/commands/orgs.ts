import { Command } from 'commander'
import { getValidToken, API_URL } from '../lib/config.js'

export interface OrgInfo {
  id: string
  slug: string
  name: string
  description: string | null
  role: string
}

export async function fetchMyOrgs(token: string): Promise<OrgInfo[]> {
  const res = await fetch(`${API_URL}/api/orgs`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    throw new Error(`Organization 목록 조회 실패 (${res.status})`)
  }
  return (await res.json()) as OrgInfo[]
}

export function registerOrgs(program: Command): void {
  const orgsCmd = program
    .command('orgs')
    .description('Organization 관련 명령어')

  orgsCmd
    .command('list')
    .description('내 Organization 목록을 확인합니다')
    .action(async () => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      const token = await getValidToken()
      if (!token) {
        if (json) {
          console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', fix: 'relay login 실행 후 재시도하세요.' }))
        } else {
          console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
          console.error('  relay login을 먼저 실행하세요.')
        }
        process.exit(1)
      }

      try {
        const orgs = await fetchMyOrgs(token)

        if (json) {
          console.log(JSON.stringify({ orgs }))
          return
        }

        if (orgs.length === 0) {
          console.log('\nOrganization이 없습니다.')
          console.log('\x1b[33m  Organization을 만들려면: relay orgs create "이름"\x1b[0m')
        } else {
          console.log(`\n\x1b[1m내 Organization\x1b[0m (${orgs.length}개):\n`)
          for (const o of orgs) {
            const role = o.role === 'owner' ? '\x1b[33m오너\x1b[0m'
              : o.role === 'admin' ? '\x1b[36m관리자\x1b[0m'
              : o.role === 'builder' ? '\x1b[36m빌더\x1b[0m'
              : '\x1b[90m멤버\x1b[0m'
            const desc = o.description
              ? `  \x1b[90m${o.description.length > 40 ? o.description.slice(0, 40) + '...' : o.description}\x1b[0m`
              : ''
            console.log(`  \x1b[36m@${o.slug}\x1b[0m  \x1b[1m${o.name}\x1b[0m  ${role}${desc}`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'FETCH_FAILED', message, fix: '네트워크 연결을 확인하거나 잠시 후 재시도하세요.' }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })

  orgsCmd
    .command('create <name>')
    .description('새 Organization을 생성합니다')
    .option('--slug <slug>', 'URL slug (미지정 시 이름에서 자동 생성)')
    .action(async (name: string, opts: { slug?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      const token = await getValidToken()
      if (!token) {
        if (json) {
          console.error(JSON.stringify({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.', fix: 'relay login 실행 후 재시도하세요.' }))
        } else {
          console.error('\x1b[31m오류: 로그인이 필요합니다.\x1b[0m')
        }
        process.exit(1)
      }

      const slug = opts.slug ?? name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50)

      try {
        const res = await fetch(`${API_URL}/api/orgs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name, slug }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: `${res.status}` })) as { message?: string; error?: string }
          throw new Error(body.message ?? `Organization 생성 실패 (${res.status})`)
        }

        const org = await res.json() as { slug: string; name: string }

        if (json) {
          console.log(JSON.stringify({ status: 'created', org }))
        } else {
          console.log(`\x1b[32m✅ Organization "${org.name}" (@${org.slug}) 생성 완료\x1b[0m`)
          console.log(`\n\x1b[33m  에이전트 배포: relay publish --org ${org.slug}\x1b[0m`)
          console.log(`\x1b[33m  멤버 초대: www.relayax.com/orgs/${org.slug}/members\x1b[0m`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'CREATE_FAILED', message }))
        } else {
          console.error(`\x1b[31m오류: ${message}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
