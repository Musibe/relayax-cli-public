import { createHash } from 'crypto'
import os from 'os'

let cachedHash: string | null = null

export function getDeviceHash(): string {
  if (cachedHash) return cachedHash
  const raw = `${os.hostname()}:${os.userInfo().username}`
  cachedHash = createHash('sha256').update(raw).digest('hex')
  return cachedHash
}
