import { API_URL } from './config.js'
import { getDeviceHash } from './device-hash.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

/**
 * Record CLI command execution to server (fire-and-forget).
 * Track user journey (login → create → publish) by device_hash.
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
