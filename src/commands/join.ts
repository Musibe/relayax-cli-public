import { Command } from 'commander'

// Re-export joinOrg for backward compatibility (used by other modules)
export { useAccessCode as joinOrg } from './grant.js'

export function registerJoin(program: Command): void {
  program
    .command('join <slug>', { hidden: true })
    .description('(deprecated) anpm grant use --code를 사용하세요')
    .requiredOption('--code <code>', '초대 코드 (UUID)')
    .action(async (_slug: string, opts: { code: string }) => {
      console.error('\x1b[33m⚠ join is deprecated. Use "anpm grant use --code" instead.\x1b[0m\n')
      // Delegate to grant use --code
      const args = ['node', 'anpm', 'grant', 'use', '--code', opts.code]
      const json = (program.opts() as { json?: boolean }).json
      if (json) args.push('--json')
      await program.parseAsync(args, { from: 'user' })
    })
}
