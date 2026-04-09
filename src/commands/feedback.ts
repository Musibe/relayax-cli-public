import { Command } from 'commander'
import { API_URL, getValidToken, loadInstalled } from '../lib/config.js'
import { getDeviceHash } from '../lib/device-hash.js'

export function registerFeedback(program: Command): void {
  program
    .command('feedback <message>')
    .description('Send feedback')
    .action(async (message: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const deviceHash = getDeviceHash()

      // Installed agent slug list
      const installed = loadInstalled()
      const installedAgents = Object.keys(installed)

      // Logged-in user info (optional)
      let userId: string | undefined
      let username: string | undefined
      const token = await getValidToken()
      if (token) {
        try {
          const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          })
          if (res.ok) {
            const me = (await res.json()) as { id: string; username?: string }
            userId = me.id
            username = me.username
          }
        } catch {
          // ignore
        }
      }

      try {
        const res = await fetch(`${API_URL}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            user_id: userId ?? null,
            username: username ?? null,
            device_hash: deviceHash,
            installed_agents: installedAgents.length > 0 ? installedAgents : null,
          }),
          signal: AbortSignal.timeout(10000),
        })

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Server error (${res.status}): ${body}`)
        }

        if (json) {
          console.log(JSON.stringify({ status: 'ok', message: 'Feedback sent successfully' }))
        } else {
          console.log('\x1b[32m✓ Feedback sent. Thank you!\x1b[0m')
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (json) {
          console.error(JSON.stringify({ error: 'FEEDBACK_FAILED', message: errMsg }))
        } else {
          console.error(`\x1b[31mFailed to send feedback: ${errMsg}\x1b[0m`)
        }
        process.exit(1)
      }
    })
}
