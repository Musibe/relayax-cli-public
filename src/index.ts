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
import { registerFollow } from './commands/follow.js'
import { registerChangelog } from './commands/changelog.js'
import { registerJoin } from './commands/join.js'
import { registerOrgs } from './commands/orgs.js'
import { registerDeployRecord } from './commands/deploy-record.js'
import { registerPing } from './commands/ping.js'
import { registerAccess } from './commands/access.js'
import { registerGrant } from './commands/grant.js'
import { registerVersions } from './commands/versions.js'
import { registerDiff } from './commands/diff.js'
import { startMcpServer } from './mcp/server.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string }

const program = new Command()

program
  .name('relay')
  .description('RelayAX Agent Team Marketplace CLI')
  .version(pkg.version)
  .option('--json', '구조화된 JSON 출력')

registerInit(program)
registerCreate(program)
registerStatus(program)
registerSearch(program)
registerInstall(program)
registerList(program)
registerUninstall(program)
registerPackage(program)
registerPublish(program)
registerLogin(program)
registerUpdate(program)
registerOutdated(program)
registerCheckUpdate(program)
registerFollow(program)
registerChangelog(program)
registerJoin(program)
registerOrgs(program)
registerDeployRecord(program)
registerPing(program)
registerAccess(program)
registerGrant(program)
registerVersions(program)
registerDiff(program)

program
  .command('mcp')
  .description('MCP 서버 모드로 실행합니다 (stdio transport)')
  .action(async () => {
    await startMcpServer()
  })

program.parse()
