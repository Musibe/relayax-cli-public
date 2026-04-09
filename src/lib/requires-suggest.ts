import fs from 'fs'
import path from 'path'
import type { Requires, RequiresEnv, RequiresCli } from '../commands/publish.js'

// Python stdlib — imports not in this set are pip package candidates
const PYTHON_STDLIB = new Set([
  'abc', 'argparse', 'ast', 'asyncio', 'base64', 'bisect', 'calendar',
  'cmath', 'codecs', 'collections', 'concurrent', 'contextlib', 'copy',
  'csv', 'ctypes', 'dataclasses', 'datetime', 'decimal', 'difflib',
  'email', 'enum', 'errno', 'filecmp', 'fnmatch', 'fractions', 'ftplib',
  'functools', 'gc', 'gettext', 'glob', 'gzip', 'hashlib', 'heapq',
  'hmac', 'html', 'http', 'imaplib', 'importlib', 'inspect', 'io',
  'itertools', 'json', 'keyword', 'linecache', 'locale', 'logging',
  'lzma', 'math', 'mimetypes', 'multiprocessing', 'numbers', 'operator',
  'os', 'pathlib', 'pickle', 'platform', 'plistlib', 'pprint',
  'profile', 'pstats', 'queue', 'random', 're', 'readline',
  'reprlib', 'resource', 'rlcompleter', 'sched', 'secrets', 'select',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtplib', 'socket',
  'socketserver', 'sqlite3', 'ssl', 'stat', 'statistics', 'string',
  'struct', 'subprocess', 'sys', 'sysconfig', 'syslog', 'tempfile',
  'textwrap', 'threading', 'time', 'timeit', 'token', 'tokenize',
  'tomllib', 'trace', 'traceback', 'tracemalloc', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings',
  'wave', 'weakref', 'webbrowser', 'xml', 'xmlrpc', 'zipfile', 'zipimport', 'zlib',
  // commonly used submodules
  'os.path', 'collections.abc', 'concurrent.futures', 'urllib.parse',
  'http.client', 'http.server', 'email.mime',
])

// pip package name → import name mapping (only when different)
const PIP_IMPORT_MAP: Record<string, string> = {
  'Pillow': 'PIL',
  'google-genai': 'google',
  'scikit-learn': 'sklearn',
  'python-dotenv': 'dotenv',
  'beautifulsoup4': 'bs4',
  'opencv-python': 'cv2',
  'pyyaml': 'yaml',
}

// import name → pip package name reverse mapping
const IMPORT_TO_PIP: Record<string, string> = {}
for (const [pip, imp] of Object.entries(PIP_IMPORT_MAP)) {
  IMPORT_TO_PIP[imp] = pip
}

interface Suggestion {
  category: 'env' | 'cli' | 'pip' | 'runtime'
  name: string
  source: string // where it was detected (filename)
  description?: string
  setup_hint?: string
  install?: string
  required?: boolean
}

/**
 * Scan .relay/ directory and suggest missing requires entries.
 */
export function suggestRequires(relayDir: string, currentRequires?: Requires): Suggestion[] {
  const suggestions: Suggestion[] = []
  const existing = normalizeExisting(currentRequires)

  // Collect all script files
  const scripts = findScripts(relayDir)

  for (const scriptPath of scripts) {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    const relName = path.relative(relayDir, scriptPath)
    const ext = path.extname(scriptPath)

    // Python scripts
    if (ext === '.py') {
      // Detect env vars: os.environ.get("VAR") / os.environ["VAR"] / os.getenv("VAR")
      const envPattern = /os\.environ\.get\(\s*['"](\w+)['"]/g
      const envPattern2 = /os\.environ\[['"](\w+)['"]\]/g
      const envPattern3 = /os\.getenv\(\s*['"](\w+)['"]/g
      for (const pattern of [envPattern, envPattern2, envPattern3]) {
        let match
        while ((match = pattern.exec(content)) !== null) {
          const varName = match[1]
          if (!existing.envNames.has(varName)) {
            suggestions.push({ category: 'env', name: varName, source: relName })
          }
        }
      }

      // Detect pip packages: import xxx / from xxx import
      const importPattern = /^(?:import|from)\s+(\w+)/gm
      let match
      while ((match = importPattern.exec(content)) !== null) {
        const moduleName = match[1]
        if (PYTHON_STDLIB.has(moduleName)) continue
        const pipName = IMPORT_TO_PIP[moduleName] ?? moduleName
        if (!existing.pipNames.has(pipName) && !existing.pipNames.has(moduleName)) {
          suggestions.push({ category: 'pip', name: pipName, source: relName })
        }
      }

      // shebang → python3 runtime
      if (content.startsWith('#!/') && content.includes('python')) {
        if (!existing.hasRuntime.python) {
          suggestions.push({ category: 'runtime', name: 'python', source: relName })
        }
      }
    }

    // Node/TS scripts
    if (ext === '.js' || ext === '.ts' || ext === '.mjs') {
      // Detect env vars: process.env.VAR / process.env['VAR']
      const envPattern = /process\.env\.(\w+)/g
      const envPattern2 = /process\.env\[['"](\w+)['"]\]/g
      for (const pattern of [envPattern, envPattern2]) {
        let match
        while ((match = pattern.exec(content)) !== null) {
          const varName = match[1]
          if (['NODE_ENV', 'PATH', 'HOME', 'PWD'].includes(varName)) continue
          if (!existing.envNames.has(varName)) {
            suggestions.push({ category: 'env', name: varName, source: relName })
          }
        }
      }
    }
  }

  // Detect setup-* skills: suggest env if not in requires
  const skillsDir = path.join(relayDir, 'skills')
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('setup-')) {
        const setupName = entry.name // e.g., setup-kling
        const skillMd = path.join(skillsDir, setupName, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          const skillContent = fs.readFileSync(skillMd, 'utf-8')
          // Find env var references in SKILL.md
          const envRefs = /[A-Z][A-Z0-9_]{2,}/g
          let match
          while ((match = envRefs.exec(skillContent)) !== null) {
            const varName = match[0]
            if (['SKILL', 'WHEN', 'THEN', 'SHALL', 'MUST', 'TODO', 'NOTE', 'IMPORTANT', 'WARNING', 'ERROR', 'JSON', 'API', 'URL', 'HTTP', 'HTTPS', 'MCP', 'CLI', 'SDK', 'README', 'YAML'].includes(varName)) continue
            if (varName.endsWith('_KEY') || varName.endsWith('_TOKEN') || varName.endsWith('_SECRET') || varName.endsWith('_SESSION')) {
              if (!existing.envNames.has(varName)) {
                suggestions.push({
                  category: 'env',
                  name: varName,
                  source: `skills/${setupName}/SKILL.md`,
                  setup_hint: `Run /${setupName} skill`,
                  required: false,
                })
              }
            }
          }
        }
      }
    }
  }

  // Detect CLI tools: subprocess.run(['cmd', ...]) / execSync('cmd ...')
  for (const scriptPath of scripts) {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    const relName = path.relative(relayDir, scriptPath)

    // Python subprocess
    const subprocessPattern = /subprocess\.(?:run|Popen|call)\(\s*\[?\s*['"](\w+)['"]/g
    let match
    while ((match = subprocessPattern.exec(content)) !== null) {
      const cmd = match[1]
      if (['python', 'python3', 'node', 'npm', 'npx'].includes(cmd)) continue
      if (!existing.cliNames.has(cmd)) {
        suggestions.push({ category: 'cli', name: cmd, source: relName })
      }
    }

    // Node execSync
    const execPattern = /execSync\(\s*['"`](\w+)/g
    while ((match = execPattern.exec(content)) !== null) {
      const cmd = match[1]
      if (['node', 'npm', 'npx', 'git'].includes(cmd)) continue
      if (!existing.cliNames.has(cmd)) {
        suggestions.push({ category: 'cli', name: cmd, source: relName })
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  return suggestions.filter((s) => {
    const key = `${s.category}:${s.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeExisting(requires?: Requires) {
  const envNames = new Set<string>()
  const cliNames = new Set<string>()
  const pipNames = new Set<string>()
  const npmNames = new Set<string>()
  const hasRuntime = { node: false, python: false }

  if (!requires) return { envNames, cliNames, pipNames, npmNames, hasRuntime }

  for (const e of requires.env ?? []) envNames.add(e.name)
  for (const c of requires.cli ?? []) cliNames.add(c.name)
  for (const n of requires.npm ?? []) npmNames.add(typeof n === 'string' ? n : n.name)
  // pip is not in Requires type but may exist in relay.yaml
  const raw = requires as Record<string, unknown>
  if (Array.isArray(raw.pip)) {
    for (const p of raw.pip) pipNames.add(typeof p === 'string' ? p : (p as { name: string }).name)
  }
  if (requires.runtime?.node) hasRuntime.node = true
  if (requires.runtime?.python) hasRuntime.python = true

  return { envNames, cliNames, pipNames, npmNames, hasRuntime }
}

function findScripts(dir: string): string[] {
  const scripts: string[] = []
  if (!fs.existsSync(dir)) return scripts

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(py|js|ts|mjs|sh)$/.test(entry.name)) {
        scripts.push(full)
      }
    }
  }
  walk(dir)
  return scripts
}

/**
 * Format suggestions in a human-readable form.
 */
export function formatSuggestions(suggestions: Suggestion[]): string[] {
  const lines: string[] = []

  const envs = suggestions.filter((s) => s.category === 'env')
  const clis = suggestions.filter((s) => s.category === 'cli')
  const pips = suggestions.filter((s) => s.category === 'pip')
  const runtimes = suggestions.filter((s) => s.category === 'runtime')

  if (envs.length > 0) {
    lines.push('  Environment variables:')
    for (const e of envs) {
      const hint = e.setup_hint ? ` (${e.setup_hint})` : ''
      lines.push(`    ${e.name}${hint} — detected in ${e.source}`)
    }
  }
  if (clis.length > 0) {
    lines.push('  CLI tools:')
    for (const c of clis) lines.push(`    ${c.name} — detected in ${c.source}`)
  }
  if (pips.length > 0) {
    lines.push('  pip packages:')
    for (const p of pips) lines.push(`    ${p.name} — detected in ${p.source}`)
  }
  if (runtimes.length > 0) {
    lines.push('  Runtime:')
    for (const r of runtimes) lines.push(`    ${r.name} — detected in ${r.source}`)
  }

  return lines
}

/**
 * Merge suggestions into a requires object.
 */
export function mergeIntoRequires(requires: Requires, suggestions: Suggestion[]): Requires {
  const result = { ...requires }

  for (const s of suggestions) {
    if (s.category === 'env') {
      if (!result.env) result.env = []
      result.env.push({
        name: s.name,
        required: s.required ?? true,
        description: s.description,
        setup_hint: s.setup_hint,
      } as RequiresEnv)
    } else if (s.category === 'cli') {
      if (!result.cli) result.cli = []
      result.cli.push({
        name: s.name,
        install: s.install,
      } as RequiresCli)
    } else if (s.category === 'runtime') {
      if (!result.runtime) result.runtime = {}
      if (s.name === 'python') result.runtime.python = '>=3.8'
      if (s.name === 'node') result.runtime.node = '>=18'
    }
  }

  return result
}
