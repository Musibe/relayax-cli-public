import { API_URL } from './config.js'
import { getDeviceHash } from './device-hash.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

/**
 * CLI 에러를 서버에 fire-and-forget으로 리포트한다.
 * 실패해도 사용자에게 표시하지 않는다.
 */
export function reportCliError(
  command: string,
  errorCode: string,
  errorMessage: string
): void {
  const deviceHash = getDeviceHash()
  fetch(`${API_URL}/api/analytics/cli-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_hash: deviceHash,
      command,
      error_code: errorCode,
      error_message: errorMessage.slice(0, 200),
      cli_version: pkg.version,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // fire-and-forget
  })
}
