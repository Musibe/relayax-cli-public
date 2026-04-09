import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(process.env.ANPM_HOME ?? process.env.RELAY_HOME ?? os.homedir(), '.anpm', 'config.json')

export interface ProviderConfig {
  api_key?: string
  default_model?: string
}

export interface AnpmConfig {
  registry?: string
  locale?: string
  providers?: {
    anthropic?: ProviderConfig
    [provider: string]: ProviderConfig | undefined
  }
  [key: string]: unknown
}

/** @deprecated Use AnpmConfig */
export type RelayConfig = AnpmConfig

export const CONFIG_DEFAULTS: AnpmConfig = {
  registry: 'https://www.anpm.io',
  locale: 'en',
}

export function loadConfig(): AnpmConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as AnpmConfig
  } catch {
    return {}
  }
}

export function saveConfig(config: AnpmConfig): void {
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

/**
 * Resolve provider API key with priority:
 * 1. explicit flag (--api-key)
 * 2. environment variable (ANTHROPIC_API_KEY etc.)
 * 3. config.json providers section
 */
export function resolveProviderApiKey(provider: string, flagValue?: string): string | undefined {
  if (flagValue) return flagValue

  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
  }

  const envKey = envMap[provider]
  if (envKey && process.env[envKey]) return process.env[envKey]

  const config = loadConfig()
  return config.providers?.[provider]?.api_key
}

/**
 * Mask an API key for display: sk-ant-xxx...xxxx
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return '****'
  return key.slice(0, 8) + '...' + key.slice(-4)
}

/**
 * Set a nested config key using dot notation.
 * e.g. "provider.anthropic.api-key" → config.providers.anthropic.api_key
 */
export function setNestedConfigKey(dotPath: string, value: string): void {
  const config = loadConfig()

  // Handle provider.X.api-key pattern
  const providerMatch = dotPath.match(/^provider\.(\w+)\.api[_-]key$/)
  if (providerMatch) {
    const provider = providerMatch[1]
    if (!config.providers) config.providers = {}
    if (!config.providers[provider]) config.providers[provider] = {}
    config.providers[provider]!.api_key = value
    saveConfig(config)
    return
  }

  // Handle provider.X.default-model pattern
  const modelMatch = dotPath.match(/^provider\.(\w+)\.default[_-]model$/)
  if (modelMatch) {
    const provider = modelMatch[1]
    if (!config.providers) config.providers = {}
    if (!config.providers[provider]) config.providers[provider] = {}
    config.providers[provider]!.default_model = value
    saveConfig(config)
    return
  }

  // Fallback: top-level key
  ;(config as Record<string, unknown>)[dotPath] = value
  saveConfig(config)
}
