import { Command } from 'commander'

export function registerCheckUpdate(program: Command): void {
  program
    .command('check-update [slug]', { hidden: true })
    .description('(deprecated) Use anpm outdated instead')
    .option('--quiet', 'Machine-readable output only when updates are available')
    .option('--force', 'Force check, ignoring cache')
    .action(async () => {
      console.error('\x1b[33m⚠ check-update is deprecated. Use "anpm outdated" instead.\x1b[0m\n')
      // Delegate to outdated
      await program.parseAsync(['node', 'anpm', 'outdated'], { from: 'user' })
    })
}
