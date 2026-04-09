import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(process.env.RELAY_HOME ?? os.homedir(), '.relay', 'config.json')

export interface RelayConfig {
  registry?: string
  locale?: string
  [key: string]: unknown
}

export const CONFIG_DEFAULTS: RelayConfig = {
  registry: 'https://www.anpm.io',
  locale: 'en',
}

export function loadConfig(): RelayConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as RelayConfig
  } catch {
    return {}
  }
}

export function saveConfig(config: RelayConfig): void {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function deleteConfigKey(key: string): void {
  const config = loadConfig()
  delete config[key]
  saveConfig(config)
}

/**
 * Get the registry URL from config, with fallback to default.
 */
export function getRegistryUrl(): string {
  const config = loadConfig()
  return config.registry ?? CONFIG_DEFAULTS.registry!
}
