import { API_URL } from './config.js'
import { getDeviceHash } from './device-hash.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

/**
 * CLI 명령 실행을 서버에 기록한다 (fire-and-forget).
 * device_hash 기준으로 사용자 여정(login → create → publish)을 추적.
 */
export function trackCommand(
  command: string,
  opts?: { slug?: string; success?: boolean }
): void {
  const deviceHash = getDeviceHash()
  fetch(`${API_URL}/api/analytics/cli-commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_hash: deviceHash,
      command,
      slug: opts?.slug ?? null,
      success: opts?.success ?? true,
      cli_version: pkg.version,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // fire-and-forget
  })
}
