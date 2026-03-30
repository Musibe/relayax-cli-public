import type { Requires } from '../commands/publish.js'

function buildSetupSection(needsLogin: boolean): string {
  const installStep = `## Step 1. Relay CLI 설치

relay CLI가 설치되어 있지 않다면:

\`\`\`bash
npm install -g relayax-cli
\`\`\`

Node.js가 없는 경우:
- macOS: \`brew install node\`
- Windows: \`winget install OpenJS.NodeJS.LTS\`
- Linux: \`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && source ~/.bashrc && nvm install --lts\`

npm 권한 오류 시:
\`\`\`bash
mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc && source ~/.zshrc
npm install -g relayax-cli
\`\`\``

  if (!needsLogin) return installStep

  return `${installStep}

## Step 2. 로그인

\`\`\`bash
relay login
\`\`\`

브라우저가 열리면 GitHub 또는 카카오 계정으로 로그인하세요.`
}

function buildRequiresSection(requires: Requires): string {
  const sections: string[] = []

  if (requires.cli && requires.cli.length > 0) {
    sections.push('### CLI 도구 설치\n')
    for (const cli of requires.cli) {
      const label = cli.required === false ? '(선택)' : '(필수)'
      if (cli.install) {
        sections.push(`- **${cli.name}** ${label}: \`${cli.install}\``)
      } else {
        sections.push(`- **${cli.name}** ${label}: 설치 후 \`which ${cli.name}\`으로 확인`)
      }
    }
    sections.push('')
  }

  if (requires.npm && requires.npm.length > 0) {
    sections.push('### npm 패키지 설치\n')
    sections.push('```bash')
    const pkgNames = requires.npm.map((p) => typeof p === 'string' ? p : p.name)
    sections.push(`npm install ${pkgNames.join(' ')}`)
    sections.push('```\n')
  }

  if (requires.env && requires.env.length > 0) {
    sections.push('### 환경변수 설정\n')
    sections.push('```bash')
    for (const env of requires.env) {
      const label = env.required === false ? '# (선택)' : '# (필수)'
      const desc = env.description ? ` — ${env.description}` : ''
      sections.push(`${env.name}=your_value_here  ${label}${desc}`)
    }
    sections.push('```\n')
  }

  if (requires.mcp && requires.mcp.length > 0) {
    sections.push('### MCP 서버 설정\n')
    for (const mcp of requires.mcp) {
      sections.push(`**${mcp.name}:**`)
      if (mcp.package) sections.push(`- 패키지: \`${mcp.package}\``)
      if (mcp.config) {
        sections.push(`- 실행: \`${mcp.config.command}${mcp.config.args ? ' ' + mcp.config.args.join(' ') : ''}\``)
      }
      if (mcp.env && mcp.env.length > 0) {
        sections.push(`- 필요한 환경변수: ${mcp.env.map((e) => `\`${e}\``).join(', ')}`)
      }
      sections.push('')
    }
  }

  if (requires.teams && requires.teams.length > 0) {
    sections.push('### 의존 팀 설치\n')
    sections.push('```bash')
    for (const team of requires.teams) {
      sections.push(`relay install ${team}`)
    }
    sections.push('```\n')
  }

  if (requires.permissions && requires.permissions.length > 0) {
    sections.push('### 권한 설정\n')
    sections.push('아래 도구 사용을 허용해야 합니다:\n')
    for (const perm of requires.permissions) {
      sections.push(`- \`${perm}\``)
    }
    sections.push('')
  }

  if (sections.length === 0) return ''
  return '## Step 4. 환경 구성\n\n' + sections.join('\n')
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
  const needsLogin = config.visibility === 'private' || config.visibility === 'gated'
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
아래 단계를 순서대로 실행하면 Agent 팀이 설치됩니다.

${setupSection}

## Step ${installStepNum}. 팀 설치

\`\`\`bash
relay install ${scopedSlug}
\`\`\`

설치 후 Agent가 자동으로 의존성을 확인하고 환경을 구성합니다.

${requiresSectionFinal}${usageHint}---
*출처: https://relayax.com — Agent Team Marketplace*
*설치: \`relay install ${scopedSlug}\`*
`
}
