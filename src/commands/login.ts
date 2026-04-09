import http from 'http'
import { Command } from 'commander'
import { execSync } from 'child_process'
import { ensureGlobalAnpmDir, saveTokenData, API_URL } from '../lib/config.js'
import { reportCliError } from '../lib/error-report.js'
import { trackCommand } from '../lib/step-tracker.js'

function openBrowser(url: string): boolean {
  const platform = process.platform
  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' })
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' })
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

async function verifyToken(token: string): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return (await res.json()) as { id: string; email: string }
  } catch {
    return null
  }
}

interface LoginResult {
  token: string
  refresh_token?: string
  expires_at?: number
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>anpm</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f5f2;color:#111318">
<div style="text-align:center">
<h2>Login complete!</h2>
<p>Return to your terminal. You can close this window.</p>
<script>setTimeout(()=>window.close(),2000)</script>
</div>
</body></html>`

function waitForToken(port: number): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Login timed out (5 minutes)'))
    }, 5 * 60 * 1000)

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)

      if (url.pathname === '/callback' && req.method === 'POST') {
        const body = await collectBody(req)
        const params = new URLSearchParams(body)

        const token = params.get('token')
        const refresh_token = params.get('refresh_token') ?? undefined
        const expires_at_raw = params.get('expires_at')
        const expires_at = expires_at_raw ? Number(expires_at_raw) : undefined

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(SUCCESS_HTML)

        clearTimeout(timeout)
        server.close()

        if (token) {
          resolve({ token, refresh_token, expires_at })
        } else {
          reject(new Error('No token received'))
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.listen(port, '127.0.0.1')
  })
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr !== 'string') {
        const port = addr.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('Could not find an available port')))
      }
    })
  })
}

async function loginWithBrowser(json: boolean): Promise<LoginResult> {
  const port = await findAvailablePort()
  const loginUrl = `${API_URL}/auth/cli-login?port=${port}`

  const opened = openBrowser(loginUrl)

  if (!json) {
    if (opened) {
      console.error(`Opening login page in browser...`)
    } else {
      console.error(`Could not open browser automatically. Open this URL in your browser:\n`)
      console.error(`  ${loginUrl}\n`)
    }
  }

  return waitForToken(port)
}

async function loginWithDevice(json: boolean): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/api/auth/device/request`, { method: 'POST' })
  if (!res.ok) {
    throw new Error('Failed to request device code')
  }

  const { device_code, user_code, verification_url, expires_in } = await res.json() as {
    device_code: string
    user_code: string
    verification_url: string
    expires_in: number
  }

  if (json) {
    console.error(JSON.stringify({ status: 'waiting', verification_url, user_code, expires_in }))
  } else {
    console.error(`\nEnter the code at this URL:\n`)
    console.error(`  ${verification_url}`)
    console.error(`\n  Code: \x1b[1m${user_code}\x1b[0m\n`)
  }

  openBrowser(`${verification_url}?user_code=${user_code}`)

  const deadline = Date.now() + expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))

    const pollRes = await fetch(`${API_URL}/api/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code }),
    })

    if (!pollRes.ok) continue

    const data = await pollRes.json() as {
      status: string
      token?: string
      refresh_token?: string
      expires_at?: string
    }

    if (data.status === 'approved' && data.token) {
      return {
        token: data.token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at ? Number(data.expires_at) : undefined,
      }
    }

    if (data.status === 'expired') {
      throw new Error('Code expired. Please try again.')
    }

    // pending — continue polling
  }

  throw new Error('Login timed out (5 minutes)')
}

/**
 * Run interactive login flow (called from auto-login).
 * Opens login page in browser and saves the received token.
 */
export async function runLogin(): Promise<void> {
  ensureGlobalAnpmDir()
  const loginResult = await loginWithBrowser(false)
  await verifyToken(loginResult.token)
  saveTokenData({
    access_token: loginResult.token,
    ...(loginResult.refresh_token ? { refresh_token: loginResult.refresh_token } : {}),
    ...(loginResult.expires_at ? { expires_at: loginResult.expires_at } : {}),
  })
  console.log(`\x1b[32m✓ Logged in\x1b[0m`)
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Log in to your anpm account')
    .option('--token <token>', 'Provide token directly (no browser)')
    .option('--device', 'Login via device code (for sandbox/remote environments)')
    .action(async (opts: { token?: string; device?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      ensureGlobalAnpmDir()
      trackCommand('login')

      let accessToken = opts.token
      let refreshToken: string | undefined
      let expiresAt: number | undefined

      if (!accessToken) {
        const loginFn = opts.device ? loginWithDevice : loginWithBrowser
        try {
          const loginResult = await loginFn(json)

          accessToken = loginResult.token
          refreshToken = loginResult.refresh_token
          expiresAt = loginResult.expires_at
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Login failed'
          reportCliError('login', 'LOGIN_FAILED', msg)
          if (json) {
            console.error(JSON.stringify({ error: 'LOGIN_FAILED', message: msg, fix: opts.device ? 'Please try again.' : 'Try anpm login --device.' }))
          } else {
            console.error(`\x1b[31mError: ${msg}\x1b[0m`)
            if (!opts.device) {
              console.error(`\n\x1b[33mTip: If browser callback doesn't work, try anpm login --device.\x1b[0m`)
            }
          }
          process.exit(1)
        }
      }

      const user = await verifyToken(accessToken)
      saveTokenData({
        access_token: accessToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      })

      const result = {
        status: 'ok',
        message: 'Login successful',
        ...(user ? { email: user.email } : {}),
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        console.log(`\x1b[32m✓ Logged in\x1b[0m`)
        if (user?.email) console.log(`  Account: \x1b[36m${user.email}\x1b[0m`)
      }
    })
}
