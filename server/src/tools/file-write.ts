import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
import type { ToolDefinition } from '../providers/types.js'

export const FILE_WRITE_DEFINITION: ToolDefinition = {
  name: 'file_write',
  description: 'Write text content to a file within the workspace. Disabled unless explicitly enabled by runtime configuration.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within workspace' },
      content: { type: 'string', description: 'File content to write' },
      overwrite: { type: 'string', description: 'Set "true" to allow overwriting an existing file. Default false.' },
    },
    required: ['path', 'content'],
  },
}

let workspaceRoot = process.cwd()
const MAX_WRITE_BYTES = 100 * 1024
const SENSITIVE_PATTERNS = ['.env', '.pem', '.key', 'id_rsa', 'id_ed25519', '.npmrc']

export function setFileWriteWorkspaceRoot(root: string): void {
  workspaceRoot = root
}

function parseBooleanString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === 'true'
}

function isPathInWorkspace(relativePath: string): boolean {
  const resolved = resolve(workspaceRoot, relativePath)
  const normalized = normalize(resolved)
  const relativeToWorkspace = relative(normalize(workspaceRoot), normalized)
  return !(isAbsolute(relativeToWorkspace) || relativeToWorkspace.startsWith('..'))
}

function isSensitivePath(relativePath: string): boolean {
  const fileName = relativePath.split('/').pop()?.split('\\').pop() ?? ''
  return SENSITIVE_PATTERNS.some((pattern) => fileName.includes(pattern))
}

export async function executeFileWrite(input: {
  path: string
  content: string
  overwrite?: string
}): Promise<string> {
  if (process.env.FILE_WRITE_TOOL_ENABLED !== 'true') {
    return 'file_write is disabled. Set FILE_WRITE_TOOL_ENABLED=true to enable this tool.'
  }

  const relativePath = typeof input.path === 'string' ? input.path.trim() : ''
  const content = typeof input.content === 'string' ? input.content : ''
  const overwrite = parseBooleanString(input.overwrite)

  if (!relativePath) {
    return 'file_write error: "path" is required.'
  }
  if (!isPathInWorkspace(relativePath)) {
    return `file_write error: path "${relativePath}" is outside workspace`
  }
  if (isSensitivePath(relativePath)) {
    return 'file_write error: sensitive path pattern detected'
  }
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > MAX_WRITE_BYTES) {
    return `file_write error: content exceeds ${MAX_WRITE_BYTES} bytes limit`
  }

  const resolvedPath = resolve(workspaceRoot, relativePath)
  const fileDir = dirname(resolvedPath)
  await mkdir(fileDir, { recursive: true })

  let existed = false
  try {
    await stat(resolvedPath)
    existed = true
  } catch {
    existed = false
  }

  if (existed && !overwrite) {
    return `file_write blocked: "${relativePath}" already exists. Set overwrite="true" to replace it.`
  }

  await writeFile(resolvedPath, content, 'utf8')
  return `file_write success: path="${relativePath}", bytes=${contentBytes}, overwritten=${existed && overwrite}`
}

