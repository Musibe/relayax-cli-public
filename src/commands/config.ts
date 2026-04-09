import { Command } from 'commander'
import { loadConfig, saveConfig, deleteConfigKey, setNestedConfigKey, maskApiKey, CONFIG_DEFAULTS } from '../lib/anpm-config.js'

export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage anpm CLI configuration')

  configCmd
    .command('get <key>')
    .description('Get a config value')
    .action((key: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const config = loadConfig()
      const value = (config as Record<string, unknown>)[key] ?? (CONFIG_DEFAULTS as Record<string, unknown>)[key]
      if (json) {
        console.log(JSON.stringify({ key, value: value ?? null }))
      } else {
        console.log(value ?? `(not set, default: ${(CONFIG_DEFAULTS as Record<string, unknown>)[key] ?? 'none'})`)
      }
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a config value (supports dot notation: provider.anthropic.api-key)')
    .action((key: string, value: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      // Support dot-notation for nested keys
      if (key.startsWith('provider.')) {
        setNestedConfigKey(key, value)
      } else {
        const config = loadConfig()
        ;(config as Record<string, unknown>)[key] = value
        saveConfig(config)
      }
      if (json) {
        console.log(JSON.stringify({ status: 'ok', key, value }))
      } else {
        console.log(`\x1b[32m✓\x1b[0m ${key} = ${value}`)
      }
    })

  configCmd
    .command('delete <key>')
    .description('Delete a config value (restore default)')
    .action((key: string) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      deleteConfigKey(key)
      if (json) {
        console.log(JSON.stringify({ status: 'ok', key, deleted: true }))
      } else {
        console.log(`\x1b[32m✓\x1b[0m ${key} deleted (restored to default)`)
      }
    })

  configCmd
    .command('list')
    .description('Show all config values')
    .action(() => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const config = loadConfig()
      const merged = { ...CONFIG_DEFAULTS, ...config }
      if (json) {
        console.log(JSON.stringify(merged))
      } else {
        for (const [key, value] of Object.entries(merged)) {
          if (key === 'providers' && typeof value === 'object' && value) {
            for (const [prov, pConfig] of Object.entries(value as Record<string, Record<string, string>>)) {
              for (const [pk, pv] of Object.entries(pConfig ?? {})) {
                const display = pk.includes('key') ? maskApiKey(String(pv)) : pv
                console.log(`  provider.${prov}.${pk} = ${display}`)
              }
            }
            continue
          }
          const isDefault = !(key in config)
          const suffix = isDefault ? ' \x1b[90m(default)\x1b[0m' : ''
          console.log(`  ${key} = ${value}${suffix}`)
        }
      }
    })
}
