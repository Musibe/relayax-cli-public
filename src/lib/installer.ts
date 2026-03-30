import fs from 'fs'
import path from 'path'

const COPY_DIRS = ['skills', 'agents', 'rules', 'commands'] as const

function copyDirRecursive(src: string, dest: string): string[] {
  const copiedFiles: string[] = []
  if (!fs.existsSync(src)) return copiedFiles

  fs.mkdirSync(dest, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copiedFiles.push(...copyDirRecursive(srcPath, destPath))
    } else {
      fs.copyFileSync(srcPath, destPath)
      copiedFiles.push(destPath)
    }
  }
  return copiedFiles
}

export function installTeam(
  extractedDir: string,
  installPath: string
): string[] {
  const installedFiles: string[] = []

  for (const dir of COPY_DIRS) {
    const srcDir = path.join(extractedDir, dir)
    const destDir = path.join(installPath, dir)
    installedFiles.push(...copyDirRecursive(srcDir, destDir))
  }

  return installedFiles
}

export function uninstallTeam(files: string[]): string[] {
  const removed: string[] = []
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue
      const stat = fs.statSync(file)
      if (stat.isDirectory()) {
        fs.rmSync(file, { recursive: true, force: true })
      } else {
        fs.unlinkSync(file)
      }
      removed.push(file)
    } catch {
      // best-effort removal
    }
  }
  return removed
}

/**
 * 빈 상위 디렉토리를 boundary까지 정리한다.
 * 예: /home/.claude/skills/cardnews/ 가 비었으면 삭제, /home/.claude/skills/는 유지
 */
export function cleanEmptyParents(filePath: string, boundary: string): void {
  let dir = path.dirname(filePath)
  while (dir.length > boundary.length && dir.startsWith(boundary)) {
    try {
      const entries = fs.readdirSync(dir)
      if (entries.length > 0) break
      fs.rmdirSync(dir)
      dir = path.dirname(dir)
    } catch {
      break
    }
  }
}
