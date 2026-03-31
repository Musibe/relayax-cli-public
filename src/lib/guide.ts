import type { Requires } from '../commands/publish.js'

interface CommandEntry {
  name: string
  description: string
}

function buildRequiresSummary(requires: Requires): string {
  const lines: string[] = []
  for (const cli of requires.cli ?? []) {
    const label = cli.required === false ? '선택' : '필수'
    lines.push(`- cli: **${cli.name}** (${label})${cli.install ? ` — \`${cli.install}\`` : ''}`)
  }
  if (requires.npm && requires.npm.length > 0) {
    const names = requires.npm.map((p) => typeof p === 'string' ? p : p.name)
    lines.push(`- npm: ${names.map((n) => `**${n}**`).join(', ')}`)
  }
  for (const env of requires.env ?? []) {
    const label = env.required === false ? '선택' : '필수'
    const desc = env.description ? ` — ${env.description}` : ''
    lines.push(`- env: **${env.name}** (${label})${desc}`)
  }
  for (const mcp of requires.mcp ?? []) {
    const pkg = mcp.package ? ` — \`${mcp.package}\`` : ''
    lines.push(`- mcp: **${mcp.name}**${pkg}`)
  }
  for (const agent of requires.agents ?? []) {
    lines.push(`- agent: **${agent}**`)
  }
  return lines.join('\n')
}

export function generateGuide(
  config: { slug: string; name: string; description: string; version: string },
  commands: CommandEntry[],
  requires?: Requires,
): string {
  const scopedSlug = config.slug.startsWith('@') ? config.slug : `@${config.slug}`
  const installCmd = `npx relayax-cli install ${scopedSlug}`

  const requiresSummary = requires ? buildRequiresSummary(requires) : ''

  return `# ${config.name}

> ${config.description}

## 설치

\`\`\`bash
${installCmd}
\`\`\`

${commands.length > 0 ? `## 포함된 커맨드

${commands.map((cmd) => `- \`/${cmd.name}\`: ${cmd.description}`).join('\n')}
` : ''}${requiresSummary ? `## 요구사항

${requiresSummary}
` : ''}---
*https://relayax.com — Agent Marketplace*
`
}
