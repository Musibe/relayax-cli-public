import os from 'os'

/**
 * 프로젝트 루트 경로를 결정한다.
 * 우선순위: --project 옵션 > RELAY_PROJECT_PATH 환경변수 > process.cwd()
 */
export function resolveProjectPath(optProject?: string): string {
  return optProject ?? process.env.RELAY_PROJECT_PATH ?? process.cwd()
}

/**
 * 홈 디렉토리 경로를 결정한다.
 * 우선순위: --home 옵션 > RELAY_HOME 환경변수 > os.homedir()
 */
export function resolveHome(optHome?: string): string {
  return optHome ?? process.env.RELAY_HOME ?? os.homedir()
}
