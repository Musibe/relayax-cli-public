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

  const slugPart = scopedSlug.startsWith('@') ? scopedSlug.slice(1) : scopedSlug
  const pluginUrl = `https://www.relayax.com/api/registry/${slugPart}/plugin`

  return `# ${config.name}

> ${config.description}

## 설치

### CLI
\`\`\`bash
${installCmd}
\`\`\`

### Claude Code Plugin
\`\`\`
/plugin marketplace add ${pluginUrl}
/plugin install ${config.slug.split('/').pop() ?? config.slug}
\`\`\`

${commands.length > 0 ? `## 포함된 커맨드

${commands.map((cmd) => `- \`/${cmd.name}\`: ${cmd.description}`).join('\n')}
` : ''}${requiresSummary ? `## 요구사항

${requiresSummary}
` : ''}---
*https://relayax.com — Agent Marketplace*
`
}
