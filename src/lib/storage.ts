import fs from 'fs'
import path from 'path'
import os from 'os'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { extract } from 'tar'

export async function downloadPackage(
  url: string,
  destDir: string
): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`패키지 다운로드 실패 (${res.status}): ${url}`)
  }

  const fileName = path.basename(new URL(url).pathname) || 'package.tar.gz'
  const destPath = path.join(destDir, fileName)

  const body = res.body
  if (!body) {
    throw new Error('응답 본문이 비어 있습니다')
  }

  const nodeReadable = Readable.fromWeb(
    body as Parameters<typeof Readable.fromWeb>[0]
  )
  await pipeline(nodeReadable, createWriteStream(destPath))
  return destPath
}

export async function extractPackage(
  tarPath: string,
  destDir: string
): Promise<void> {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }
  await extract({ file: tarPath, cwd: destDir })
}

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'))
}

export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}
