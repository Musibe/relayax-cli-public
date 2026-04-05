import type { Requires, RequiresEnv, RequiresCli, RequiresMcp, RequiresNpm } from '../commands/publish.js'

/**
 * relay.yaml의 requires를 기반으로 setup slash command .md 내용을 생성한다.
 * requires가 없거나 빈 객체이면 null을 반환한다.
 */
export function generateSetupCommand(agentName: string, requires: Requires | undefined, mainCommandName?: string): string | null {
  if (!requires) return null

  const sections: string[] = []

  // runtime
  if (requires.runtime) {
    const items: string[] = []
    if (requires.runtime.node) items.push(`- Node.js \`>=${requires.runtime.node}\``)
    if (requires.runtime.python) items.push(`- Python \`>=${requires.runtime.python}\``)
    if (items.length > 0) {
      sections.push(`### 런타임\n${items.join('\n')}`)
    }
  }

  // cli
  if (requires.cli && requires.cli.length > 0) {
    const items = requires.cli.map((c: RequiresCli) => {
      const req = c.required !== false ? '필수' : '선택'
      const install = c.install ? ` — 설치: \`${c.install}\`` : ''
      return `- \`${c.name}\` (${req})${install}`
    })
    sections.push(`### CLI 도구\n${items.join('\n')}`)
  }

  // env
  if (requires.env && requires.env.length > 0) {
    const items = requires.env.map((e: RequiresEnv) => {
      const req = e.required !== false ? '필수' : '선택'
      const desc = e.description ? ` — ${e.description}` : ''
      const hint = e.setup_hint ? `\n  설정 방법:\n${e.setup_hint.split('\n').map((l: string) => `    ${l}`).join('\n')}` : ''
      return `- \`${e.name}\` (${req})${desc}${hint}`
    })
    sections.push(`### 환경변수\n${items.join('\n')}`)
  }

  // npm
  if (requires.npm && requires.npm.length > 0) {
    const items = requires.npm.map((n: string | RequiresNpm) => {
      const name = typeof n === 'string' ? n : n.name
      const req = typeof n === 'string' ? '필수' : (n.required !== false ? '필수' : '선택')
      return `- \`${name}\` (${req})`
    })
    sections.push(`### npm 패키지\n${items.join('\n')}`)
  }

  // mcp
  if (requires.mcp && requires.mcp.length > 0) {
    const items = requires.mcp.map((m: RequiresMcp) => {
      const req = m.required !== false ? '필수' : '선택'
      const pkg = m.package ? ` — 패키지: \`${m.package}\`` : ''
      const envList = m.env && m.env.length > 0 ? `\n  필요한 환경변수: ${m.env.map((e: string) => `\`${e}\``).join(', ')}` : ''
      const config = m.config ? `\n  설정: \`${JSON.stringify(m.config)}\`` : ''
      return `- \`${m.name}\` MCP 서버 (${req})${pkg}${envList}${config}`
    })
    sections.push(`### MCP 서버\n${items.join('\n')}`)
  }

  if (sections.length === 0) return null

  const body = `# ${agentName} 설정 가이드

아래 요구사항을 각각 체크하고, 미충족 항목이 있으면 사용자가 설정할 수 있도록 안내하세요.
모든 항목이 충족될 때까지 멈추지 말고 끝까지 진행하세요.
${mainCommandName ? `\n모든 설정이 완료되면 \`/${mainCommandName}\`으로 에이전트를 사용할 수 있다고 안내하세요.` : ''}

${sections.join('\n\n')}`

  return `---\ndescription: ${agentName} 설정 가이드 — 필수 요구사항을 확인하고 설정합니다\n---\n\n${body}\n`
}
