import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

export function registerChangelog(program: Command): void {
  const changelog = program
    .command('changelog')
    .description('에이전트 패키지의 changelog를 관리합니다')

  changelog
    .command('add')
    .description('relay.yaml에 changelog 엔트리를 추가합니다')
    .argument('[message]', 'changelog 메시지 (없으면 에디터에서 입력)')
    .action(async (message?: string) => {
      const yamlPath = path.resolve('relay.yaml')

      if (!fs.existsSync(yamlPath)) {
        console.error('relay.yaml을 찾을 수 없습니다. 에이전트 패키지 디렉토리에서 실행하세요.')
        process.exit(1)
      }

      const content = fs.readFileSync(yamlPath, 'utf-8')
      const doc = yaml.load(content) as Record<string, unknown> ?? {}

      if (!message) {
        // Read from stdin if piped, otherwise prompt
        const readline = await import('readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        message = await new Promise<string>((resolve) => {
          rl.question('Changelog 메시지: ', (answer) => {
            rl.close()
            resolve(answer)
          })
        })
      }

      if (!message || message.trim() === '') {
        console.error('changelog 메시지가 비어있습니다.')
        process.exit(1)
      }

      const version = String(doc.version ?? '1.0.0')
      const date = new Date().toISOString().split('T')[0]
      const entry = `## v${version} (${date})\n\n- ${message.trim()}`

      const existing = doc.changelog ? String(doc.changelog) : ''
      doc.changelog = existing ? `${entry}\n\n${existing}` : entry

      fs.writeFileSync(yamlPath, yaml.dump(doc, { lineWidth: -1, noRefs: true }), 'utf-8')

      console.log(`\x1b[32m✓\x1b[0m changelog 추가됨 (v${version})`)
      console.log(`  ${message.trim()}`)
    })

  changelog
    .command('show')
    .description('현재 relay.yaml의 changelog를 표시합니다')
    .action(() => {
      const yamlPath = path.resolve('relay.yaml')

      if (!fs.existsSync(yamlPath)) {
        console.error('relay.yaml을 찾을 수 없습니다.')
        process.exit(1)
      }

      const content = fs.readFileSync(yamlPath, 'utf-8')
      const doc = yaml.load(content) as Record<string, unknown> ?? {}

      if (!doc.changelog) {
        console.log('changelog가 없습니다. `relay changelog add "메시지"`로 추가하세요.')
        return
      }

      console.log(String(doc.changelog))
    })
}
