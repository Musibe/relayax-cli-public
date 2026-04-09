import { Command } from 'commander'

export function registerChangelog(program: Command): void {
  program
    .command('changelog [slug]', { hidden: true })
    .description('(deprecated) Use anpm versions instead')
    .action(async (slug?: string) => {
      console.error('\x1b[33m⚠ changelog is deprecated. Use "anpm versions <slug>" instead.\x1b[0m\n')
      if (slug) {
        await program.parseAsync(['node', 'anpm', 'versions', slug], { from: 'user' })
      } else {
        console.error('Usage: anpm versions <slug>')
      }
    })
}
