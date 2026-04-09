import { Command } from 'commander'

export function registerAccess(program: Command): void {
  program
    .command('access <slug>', { hidden: true })
    .description('(deprecated) anpm install --code를 사용하세요')
    .requiredOption('--code <code>', '에이전트 초대 코드')
    .action(async (slug: string, opts: { code: string }) => {
      console.error('\x1b[33m⚠ access is deprecated. Use "anpm install --code" instead.\x1b[0m\n')
      // Delegate to install --code
      const args = ['node', 'anpm', 'install', slug, '--code', opts.code]
      const json = (program.opts() as { json?: boolean }).json
      if (json) args.push('--json')
      await program.parseAsync(args, { from: 'user' })
    })
}
