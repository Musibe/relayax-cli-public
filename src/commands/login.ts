import http from 'http'
import { Command } from 'commander'
import { execSync } from 'child_process'
import { ensureGlobalRelayDir, saveTokenData, API_URL } from '../lib/config.js'

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
<html><head><title>RelayAX</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f5f2;color:#111318">
<div style="text-align:center">
<h2>로그인 완료!</h2>
<p>터미널로 돌아가세요. 이 창은 닫아도 됩니다.</p>
<script>setTimeout(()=>window.close(),2000)</script>
</div>
</body></html>`

function waitForToken(port: number): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('로그인 시간이 초과되었습니다 (5분)'))
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
          reject(new Error('토큰이 전달되지 않았습니다'))
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
        server.close(() => reject(new Error('포트를 찾을 수 없습니다')))
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
      console.error(`브라우저에서 로그인 페이지를 엽니다...`)
    } else {
      console.error(`브라우저를 자동으로 열 수 없습니다. 아래 URL을 브라우저에서 직접 열어주세요:\n`)
      console.error(`  ${loginUrl}\n`)
    }
  }

  return waitForToken(port)
}

/**
 * 대화형 로그인 플로우 실행 (auto-login에서 호출).
 * 브라우저에서 로그인 페이지를 열고 토큰을 받아 저장.
 */
export async function runLogin(): Promise<void> {
  ensureGlobalRelayDir()
  const loginResult = await loginWithBrowser(false)
  await verifyToken(loginResult.token)
  saveTokenData({
    access_token: loginResult.token,
    ...(loginResult.refresh_token ? { refresh_token: loginResult.refresh_token } : {}),
    ...(loginResult.expires_at ? { expires_at: loginResult.expires_at } : {}),
  })
  console.log(`\x1b[32m✓ 로그인 완료\x1b[0m`)
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('RelayAX 계정에 로그인합니다')
    .option('--token <token>', '직접 토큰 입력 (브라우저 없이)')
    .action(async (opts: { token?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false

      ensureGlobalRelayDir()

      let accessToken = opts.token
      let refreshToken: string | undefined
      let expiresAt: number | undefined

      if (!accessToken) {
        try {
          const loginResult = await loginWithBrowser(json)

          accessToken = loginResult.token
          refreshToken = loginResult.refresh_token
          expiresAt = loginResult.expires_at
        } catch (err) {
          const msg = err instanceof Error ? err.message : '로그인 실패'
          if (json) {
            console.error(JSON.stringify({ error: 'LOGIN_FAILED', message: msg, fix: '브라우저에서 로그인을 완료하고 relay login을 재시도하세요.' }))
          } else {
            console.error(`\x1b[31m오류: ${msg}\x1b[0m`)
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
        message: '로그인 성공',
        ...(user ? { email: user.email } : {}),
      }

      if (json) {
        console.log(JSON.stringify(result))
      } else {
        console.log(`\x1b[32m✓ 로그인 완료\x1b[0m`)
        if (user?.email) console.log(`  계정: \x1b[36m${user.email}\x1b[0m`)
      }
    })
}
