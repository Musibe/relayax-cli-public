import type { Requires, RequiresEnv, RequiresCli, RequiresMcp, RequiresNpm } from '../commands/publish.js'

/**
 * Generate setup slash command .md content from relay.yaml requires.
 * Returns null if requires is missing or empty.
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
      sections.push(`### Runtime\n${items.join('\n')}`)
    }
  }

  // cli
  if (requires.cli && requires.cli.length > 0) {
    const items = requires.cli.map((c: RequiresCli) => {
      const req = c.required !== false ? 'required' : 'optional'
      const install = c.install ? ` — install: \`${c.install}\`` : ''
      return `- \`${c.name}\` (${req})${install}`
    })
    sections.push(`### CLI tools\n${items.join('\n')}`)
  }

  // env
  if (requires.env && requires.env.length > 0) {
    const items = requires.env.map((e: RequiresEnv) => {
      const req = e.required !== false ? 'required' : 'optional'
      const desc = e.description ? ` — ${e.description}` : ''
      const hint = e.setup_hint ? `\n  Setup:\n${e.setup_hint.split('\n').map((l: string) => `    ${l}`).join('\n')}` : ''
      return `- \`${e.name}\` (${req})${desc}${hint}`
    })
    sections.push(`### Environment variables\n${items.join('\n')}`)
  }

  // npm
  if (requires.npm && requires.npm.length > 0) {
    const items = requires.npm.map((n: string | RequiresNpm) => {
      const name = typeof n === 'string' ? n : n.name
      const req = typeof n === 'string' ? 'required' : (n.required !== false ? 'required' : 'optional')
      return `- \`${name}\` (${req})`
    })
    sections.push(`### npm packages\n${items.join('\n')}`)
  }

  // mcp
  if (requires.mcp && requires.mcp.length > 0) {
    const items = requires.mcp.map((m: RequiresMcp) => {
      const req = m.required !== false ? 'required' : 'optional'
      const pkg = m.package ? ` — package: \`${m.package}\`` : ''
      const envList = m.env && m.env.length > 0 ? `\n  Required env vars: ${m.env.map((e: string) => `\`${e}\``).join(', ')}` : ''
      const config = m.config ? `\n  Config: \`${JSON.stringify(m.config)}\`` : ''
      return `- \`${m.name}\` MCP server (${req})${pkg}${envList}${config}`
    })
    sections.push(`### MCP servers\n${items.join('\n')}`)
  }

  if (sections.length === 0) return null

  const body = `# ${agentName} Setup Guide

Check each requirement below and guide the user to configure any missing items.
Continue until all requirements are met.
${mainCommandName ? `\nOnce setup is complete, let the user know they can use \`/${mainCommandName}\` to start.` : ''}

${sections.join('\n\n')}`

  return `---\ndescription: ${agentName} setup guide — check and configure dependencies\n---\n\n${body}\n`
}
