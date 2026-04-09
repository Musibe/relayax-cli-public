import { Command } from 'commander'

export function registerCheckUpdate(program: Command): void {
  program
    .command('check-update [slug]', { hidden: true })
    .description('(deprecated) anpm outdated를 사용하세요')
    .option('--quiet', '업데이트가 있을 때만 머신 리더블 출력')
    .option('--force', '캐시를 무시하고 강제 체크')
    .action(async () => {
      console.error('\x1b[33m⚠ check-update is deprecated. Use "anpm outdated" instead.\x1b[0m\n')
      // Delegate to outdated
      await program.parseAsync(['node', 'anpm', 'outdated'], { from: 'user' })
    })
}
