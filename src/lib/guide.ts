import type { Requires } from '../commands/publish.js'
import { REQUIREMENTS_CHECK, SETUP_CLI, SETUP_LOGIN } from '../prompts/index.js'

function buildSetupSection(needsLogin: boolean): string {
  if (!needsLogin) return SETUP_CLI
  return `${SETUP_CLI}\n\n${SETUP_LOGIN}`
}

function buildRequiresSummary(requires: Requires): string {
  const lines: string[] = []

  if (requires.cli && requires.cli.length > 0) {
    for (const cli of requires.cli) {
      const label = cli.required === false ? '선택' : '필수'
      lines.push(`- cli: **${cli.name}** (${label})${cli.install ? ` — \`${cli.install}\`` : ''}`)
    }
  }

  if (requires.npm && requires.npm.length > 0) {
    const pkgNames = requires.npm.map((p) => typeof p === 'string' ? p : p.name)
    lines.push(`- npm: ${pkgNames.map((n) => `**${n}**`).join(', ')}`)
  }

  if (requires.env && requires.env.length > 0) {
    for (const env of requires.env) {
      const label = env.required === false ? '선택' : '필수'
      const desc = env.description ? ` — ${env.description}` : ''
      lines.push(`- env: **${env.name}** (${label})${desc}`)
    }
  }

  if (requires.mcp && requires.mcp.length > 0) {
    for (const mcp of requires.mcp) {
      const pkg = mcp.package ? ` — \`${mcp.package}\`` : ''
      lines.push(`- mcp: **${mcp.name}**${pkg}`)
    }
  }

  if (requires.agents && requires.agents.length > 0) {
    for (const agent of requires.agents) {
      lines.push(`- agents: **${agent}**`)
    }
  }

  if (requires.permissions && requires.permissions.length > 0) {
    lines.push(`- permissions: ${requires.permissions.map((p) => `\`${p}\``).join(', ')}`)
  }

  return lines.join('\n')
}

function buildRequiresSection(requires: Requires): string {
  const summary = buildRequiresSummary(requires)
  if (!summary) return ''

  return `## Step 4. 의존성 확인 및 설치

이 에이전트는 아래 의존성이 필요합니다:

${summary}

${REQUIREMENTS_CHECK}
`
}

interface CommandEntry {
  name: string
  description: string
}

export function generateGuide(
  config: { slug: string; name: string; description: string; version: string; visibility?: string },
  commands: CommandEntry[],
  requires?: Requires,
): string {
  const scopedSlug = config.slug.startsWith('@') ? config.slug : `@${config.slug}`
  const needsLogin = config.visibility === 'internal' || config.visibility === 'private'
  const setupSection = buildSetupSection(needsLogin)
  const installStepNum = needsLogin ? 3 : 2

  const requiresSection = requires ? buildRequiresSection(requires) : ''
  const requiresSectionFinal = requiresSection
    ? requiresSection.replace('## Step 4.', `## Step ${installStepNum + 1}.`)
    : ''

  let usageHint = ''
  if (commands.length > 0) {
    usageHint = `## 사용법

설치가 완료되면 아래 커맨드를 사용할 수 있습니다:

${commands.map((cmd) => `- \`/${cmd.name}\`: ${cmd.description}`).join('\n')}

원하는 작업을 말하거나 위 커맨드를 직접 실행하세요.
`
  }

  return `# ${config.name} — 설치 가이드

> ${config.description}

이 가이드는 [RelayAX](https://relayax.com)에서 자동 생성되었습니다.
아래 단계를 순서대로 실행하면 에이전트가 설치됩니다.

${setupSection}

## Step ${installStepNum}. 에이전트 설치

\`\`\`bash
relay install ${scopedSlug}
\`\`\`

설치 후 아래 의존성을 확인하고 환경을 구성합니다.

${requiresSectionFinal}${usageHint}---
*출처: https://relayax.com — Agent Marketplace*
*설치: \`relay install ${scopedSlug}\`*
`
}
