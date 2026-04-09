import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getValidToken, API_URL } from '../lib/config.js'
import fs from 'fs'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string }

// ─── Helpers ───

function jsonText(obj: unknown) {
  return { type: 'text' as const, text: JSON.stringify(obj) }
}

// ─── Server ───

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'relay', version: pkg.version },
    { capabilities: { tools: {} } },
  )

  // ═══ Detail Images — Agent detail page image management ═══

  server.tool('relay_detail_upload', 'Upload images to agent detail page. Images in the folder are sorted by filename and uploaded (replaces all existing images).', {
    slug: z.string().describe('Agent slug'),
    path: z.string().describe('Folder path containing images (PNG/GIF/JPEG/WebP)'),
  }, async ({ slug, path: dirPath }) => {
    try {
      const token = await getValidToken()
      if (!token) return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: 'Authentication required.' })], isError: true }

      const absPath = path.resolve(dirPath)
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        return { content: [jsonText({ error: `Folder not found: ${absPath}` })], isError: true }
      }

      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
      const files = fs.readdirSync(absPath)
        .filter((f) => imageExts.includes(path.extname(f).toLowerCase()))
        .sort()

      if (files.length === 0) {
        return { content: [jsonText({ error: 'No image files found in folder (PNG/GIF/JPEG/WebP)' })], isError: true }
      }

      const formData = new FormData()
      for (const file of files) {
        const filePath = path.join(absPath, file)
        const buffer = fs.readFileSync(filePath)
        const ext = path.extname(file).toLowerCase()
        const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
        const blob = new Blob([buffer], { type: mimeMap[ext] || 'image/png' })
        formData.append('files', blob, file)
      }

      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData as unknown as BodyInit,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { content: [jsonText({ error: (body as { message?: string }).message || `Upload failed (${res.status})` })], isError: true }
      }

      const result = await res.json() as { detail_images: string[]; count: number }
      return { content: [jsonText({ status: 'uploaded', count: result.count, images: result.detail_images })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_detail_list', 'List agent detail page images', {
    slug: z.string().describe('Agent slug'),
  }, async ({ slug }) => {
    try {
      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`)
      if (!res.ok) {
        return { content: [jsonText({ error: `Fetch failed (${res.status})` })], isError: true }
      }
      const data = await res.json() as { detail_images: string[] }
      return { content: [jsonText({ detail_images: data.detail_images, count: data.detail_images.length })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  server.tool('relay_detail_clear', 'Delete all agent detail page images', {
    slug: z.string().describe('Agent slug'),
  }, async ({ slug }) => {
    try {
      const token = await getValidToken()
      if (!token) return { content: [jsonText({ error: 'LOGIN_REQUIRED', message: 'Authentication required.' })], isError: true }

      const res = await fetch(`${API_URL}/api/agents/${slug}/detail-images`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return { content: [jsonText({ error: (body as { message?: string }).message || `Delete failed (${res.status})` })], isError: true }
      }

      const result = await res.json() as { deleted: number }
      return { content: [jsonText({ status: 'cleared', deleted: result.deleted })] }
    } catch (err) {
      return { content: [jsonText({ error: String(err) })], isError: true }
    }
  })

  return server
}

// ─── Start ───

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
