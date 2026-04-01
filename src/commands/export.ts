import fs from 'fs'
import path from 'path'
import { Command } from 'commander'
import yaml from 'js-yaml'
import { generateManifests, SUPPORTED_PLATFORMS } from '../lib/manifest-generator.js'
import type { ManifestRelayYaml } from '../lib/manifest-generator.js'
import { resolveProjectPath } from '../lib/paths.js'

export function registerExport(program: Command): void {
  program
    .command('export <platform>')
    .description('로컬에서 플랫폼 네이티브 매니페스트를 생성합니다')
    .option('--out <dir>', '출력 디렉토리 (기본: .relay/export/<platform>/)')
    .option('--project <dir>', '프로젝트 루트 경로')
    .action(async (platform: string, opts: { out?: string; project?: string }) => {
      const json = (program.opts() as { json?: boolean }).json ?? false
      const projectPath = resolveProjectPath(opts.project)
      const relayDir = path.join(projectPath, '.relay')
      const relayYamlPath = path.join(relayDir, 'relay.yaml')

      // Check relay.yaml exists
      if (!fs.existsSync(relayYamlPath)) {
        const msg = 'relay.yaml not found'
        if (json) {
          console.error(JSON.stringify({ error: 'NOT_FOUND', message: msg }))
        } else {
          console.error(`\x1b[31m${msg}\x1b[0m`)
          console.error('  relay.yaml이 있는 에이전트 디렉토리에서 실행하세요.')
        }
        process.exit(1)
      }

      // Validate platform
      const validPlatforms = [...SUPPORTED_PLATFORMS, 'all']
      if (!validPlatforms.includes(platform)) {
        const msg = `지원하지 않는 플랫폼: ${platform}`
        if (json) {
          console.error(JSON.stringify({ error: 'INVALID_PLATFORM', message: msg, supported: SUPPORTED_PLATFORMS }))
        } else {
          console.error(`\x1b[31m${msg}\x1b[0m`)
          console.error(`  지원 플랫폼: ${SUPPORTED_PLATFORMS.join(', ')}, all`)
        }
        process.exit(1)
      }

      // Parse relay.yaml
      const yamlContent = fs.readFileSync(relayYamlPath, 'utf-8')
      const raw = yaml.load(yamlContent) as Record<string, unknown> ?? {}

      const manifestYaml: ManifestRelayYaml = {
        name: String(raw.name ?? ''),
        slug: String(raw.slug ?? ''),
        description: String(raw.description ?? ''),
        version: String(raw.version ?? '1.0.0'),
        source: raw.source ? String(raw.source) : undefined,
        org_slug: raw.org_slug ? String(raw.org_slug) : undefined,
        platforms: platform === 'all' ? undefined : [platform],
      }

      // Generate manifests
      const files = generateManifests(manifestYaml, relayDir)

      if (files.length === 0) {
        if (json) {
          console.log(JSON.stringify({ status: 'empty', message: '생성할 매니페스트가 없습니다.' }))
        } else {
          console.log('생성할 매니페스트가 없습니다.')
        }
        return
      }

      // Determine output directory
      const outDir = opts.out
        ? path.resolve(opts.out)
        : path.join(relayDir, 'export', platform)
      fs.mkdirSync(outDir, { recursive: true })

      // Write files
      const written: string[] = []
      for (const file of files) {
        const filePath = path.join(outDir, file.relativePath)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, file.content)
        written.push(file.relativePath)
      }

      if (json) {
        console.log(JSON.stringify({ status: 'ok', platform, output_dir: outDir, files: written }))
      } else {
        console.log(`\n\x1b[32m✓ 매니페스트 생성 완료\x1b[0m  (${platform})`)
        console.log(`  출력: \x1b[36m${outDir}\x1b[0m\n`)
        for (const f of written) {
          console.log(`  \x1b[90m•\x1b[0m ${f}`)
        }

        // Platform-specific usage hints
        console.log('')
        if (platform === 'claude-code' || platform === 'all') {
          console.log('  \x1b[90mClaude Code:\x1b[0m /plugin marketplace add <marketplace.json URL>')
        }
        if (platform === 'codex' || platform === 'all') {
          console.log('  \x1b[90mCodex:\x1b[0m .codex-plugin/plugin.json을 Codex에 등록하세요')
        }
        if (platform === 'antigravity' || platform === 'all') {
          console.log('  \x1b[90mAntigravity:\x1b[0m .agent/skills/를 프로젝트에 복사하세요')
        }
      }
    })
}
