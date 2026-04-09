#!/usr/bin/env node

import { Command } from 'commander'
import { registerInit } from './commands/init.js'
import { registerCreate } from './commands/create.js'
import { registerStatus } from './commands/status.js'
import { registerSearch } from './commands/search.js'
import { registerInstall } from './commands/install.js'
import { registerList } from './commands/list.js'
import { registerUninstall } from './commands/uninstall.js'
import { registerPackage } from './commands/package.js'
import { registerPublish } from './commands/publish.js'
import { registerLogin } from './commands/login.js'
import { registerUpdate } from './commands/update.js'
import { registerOutdated } from './commands/outdated.js'
import { registerCheckUpdate } from './commands/check-update.js'
import { registerChangelog } from './commands/changelog.js'
import { registerJoin } from './commands/join.js'
import { registerOrgs } from './commands/orgs.js'
import { registerDeployRecord } from './commands/deploy-record.js'
import { registerPing } from './commands/ping.js'
import { registerAccess } from './commands/access.js'
import { registerGrant } from './commands/grant.js'
import { registerVersions } from './commands/versions.js'
import { registerDiff } from './commands/diff.js'
import { registerFeedback } from './commands/feedback.js'
import { registerLink } from './commands/link.js'
import { registerConfig } from './commands/config.js'
import { registerAdopt } from './commands/adopt.js'
import { registerRun } from './commands/run.js'
import { registerDeploy } from './commands/deploy.js'
import { startMcpServer } from './mcp/server.js'
import { migrateGlobalDir, migrateProjectDir } from './lib/migration.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string }

const program = new Command()

program
  .name('anpm')
  .description('anpm — the agent package manager')
  .version(pkg.version)
  .option('--json', '구조화된 JSON 출력')

// ── Core commands ──
registerInit(program)
registerCreate(program)
registerInstall(program)
registerUninstall(program)
registerUpdate(program)
registerList(program)
registerSearch(program)
registerPublish(program)
registerLogin(program)
registerOrgs(program)
registerGrant(program)
registerVersions(program)
registerOutdated(program)
registerDiff(program)
registerStatus(program)
registerConfig(program)
registerLink(program)
registerRun(program)
registerDeploy(program)
registerFeedback(program)

// ── Hidden (internal plumbing) ──
registerDeployRecord(program)
registerPing(program)
registerPackage(program)
registerAdopt(program)

// ── Deprecated (redirect to canonical commands) ──
registerCheckUpdate(program)
registerAccess(program)
registerJoin(program)
registerChangelog(program)

program
  .command('mcp')
  .description('MCP 서버 모드로 실행합니다 (stdio transport)')
  .action(async () => {
    await startMcpServer()
  })

// 모든 명령 실행 전 마이그레이션 + 버전 표시
program.hook('preAction', (_thisCommand, actionCommand) => {
  const isJson = program.opts().json ?? false
  const isMcp = actionCommand.name() === 'mcp'

  // 마이그레이션은 항상 실행 (mcp 제외)
  if (!isMcp) {
    migrateGlobalDir()
    migrateProjectDir(process.env.RELAY_PROJECT_PATH ?? process.cwd())
  }

  // 버전 표시는 TTY + non-json만
  if (!isJson && !isMcp && process.stderr.isTTY) {
    process.stderr.write(`\x1b[2manpm v${pkg.version}\x1b[0m\n`)
  }
})

program.parse()
