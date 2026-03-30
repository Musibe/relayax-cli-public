import { Command } from 'commander'
import { followBuilder } from '../lib/api.js'
import { getValidToken } from '../lib/config.js'

export function registerFollow(program: Command): void {
  program
    .command('follow <username>')
    .description('빌더를 팔로우합니다 (새 버전 알림)')
    .action(async (username: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      // Strip @ prefix if present
      const cleanUsername = username.startsWith('@') ? username.slice(1) : username

      const token = await getValidToken()
      if (!token) {
        const msg = '로그인이 필요합니다. `relay login`을 먼저 실행하세요.'
        if (json) {
          console.log(JSON.stringify({ error: 'NO_TOKEN', message: msg, fix: 'relay login 실행 후 재시도하세요.' }))
        } else {
          console.error(msg)
        }
        process.exit(1)
      }

      try {
        await followBuilder(cleanUsername)
        if (json) {
          console.log(JSON.stringify({ ok: true, following: cleanUsername }))
        } else {
          console.log(`\x1b[32m✓ @${cleanUsername} 팔로우 완료\x1b[0m — 새 버전 알림을 받습니다.`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          console.log(JSON.stringify({ error: 'FOLLOW_FAILED', message, fix: 'username을 확인하거나 잠시 후 재시도하세요.' }))
        } else {
          console.error(`팔로우 실패: ${message}`)
        }
        process.exit(1)
      }
    })
}
