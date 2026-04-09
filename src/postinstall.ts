#!/usr/bin/env node
/**
 * postinstall — runs automatically after npm install -g anpm-io
 *
 * 1. Install global slash commands to detected agent CLIs
 * 2. Print installation summary
 */

import { installGlobalUserCommands } from './commands/init.js'
import { detectGlobalCLIs } from './lib/ai-tools.js'

try {
  const detectedCLIs = detectGlobalCLIs()
  const result = installGlobalUserCommands()

  console.log('')
  console.log('  \x1b[32m✓ anpm installed!\x1b[0m')
  console.log('')

  if (result.tools.length > 0) {
    console.log(`  \x1b[36mSlash commands installed:\x1b[0m ${result.tools.join(', ')}`)
    console.log('')
    console.log('  Available commands:')
    console.log('    /relay-explore     Discover & recommend agents')
    console.log('    /relay-create      Create & publish agents')
    console.log('    /relay-status      Installation status & Organizations')
    console.log('    /relay-uninstall   Remove agents')
  } else {
    console.log('  \x1b[33mNo agent CLI detected.\x1b[0m')
    console.log('  Install Claude Code, Cursor, etc. then run \x1b[36manpm init\x1b[0m.')
  }

  console.log('')
  console.log('  \x1b[2mGet started: anpm login\x1b[0m')
  console.log('')
} catch {
  // CLI install should succeed even if postinstall fails
  console.log('')
  console.log('  \x1b[32m✓ anpm installed!\x1b[0m')
  console.log('  \x1b[2mGet started: anpm login\x1b[0m')
  console.log('')
}
