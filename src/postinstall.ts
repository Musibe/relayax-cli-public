#!/usr/bin/env node
/**
 * postinstall — npm install -g relayax-cli 후 자동 실행
 *
 * 1. 감지된 에이전트 CLI에 글로벌 슬래시 커맨드 설치
 * 2. 설치 결과 안내 메시지 출력
 */

import { installGlobalUserCommands } from './commands/init.js'
import { detectGlobalCLIs } from './lib/ai-tools.js'

try {
  const detectedCLIs = detectGlobalCLIs()
  const result = installGlobalUserCommands()

  console.log('')
  console.log('  \x1b[32m✓ relayax-cli 설치 완료!\x1b[0m')
  console.log('')

  if (result.tools.length > 0) {
    console.log(`  \x1b[36m슬래시 커맨드 설치됨:\x1b[0m ${result.tools.join(', ')}`)
    console.log('')
    console.log('  사용 가능한 커맨드:')
    console.log('    /relay-explore     에이전트 탐색 & 추천')
    console.log('    /relay-create      에이전트 생성 & 배포')
    console.log('    /relay-status      설치 현황 & Organization')
    console.log('    /relay-uninstall   에이전트 삭제')
  } else {
    console.log('  \x1b[33m에이전트 CLI가 감지되지 않았습니다.\x1b[0m')
    console.log('  Claude Code, Cursor 등 설치 후 \x1b[36mrelay init\x1b[0m을 실행하세요.')
  }

  console.log('')
  console.log('  \x1b[2m시작하기: relay login\x1b[0m')
  console.log('')
} catch {
  // postinstall 실패해도 CLI 설치는 성공해야 함
  console.log('')
  console.log('  \x1b[32m✓ relayax-cli 설치 완료!\x1b[0m')
  console.log('  \x1b[2m시작하기: relay login\x1b[0m')
  console.log('')
}
