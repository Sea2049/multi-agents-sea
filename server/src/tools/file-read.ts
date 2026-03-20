import { readFile } from 'node:fs/promises'
import { resolve, normalize, relative, isAbsolute } from 'node:path'
import type { ToolDefinition } from '../providers/types.js'

export const FILE_READ_DEFINITION: ToolDefinition = {
  name: 'file_read',
  description: 'Read the contents of a file from the local workspace. Only files within the workspace directory are accessible.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file within the workspace' },
      maxChars: { type: 'string', description: 'Maximum characters to read (default: 4000)' },
    },
    required: ['path'],
  },
}

let workspaceRoot = process.cwd()

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root
}

export async function executeFileRead(input: { path: string; maxChars?: string }): Promise<string> {
  const { path: relativePath, maxChars } = input
  const maxLength = parseInt(maxChars ?? '4000', 10) || 4000

  const resolved = resolve(workspaceRoot, relativePath)
  const normalized = normalize(resolved)
  const relativeToWorkspace = relative(normalize(workspaceRoot), normalized)

  if (isAbsolute(relativeToWorkspace) || relativeToWorkspace.startsWith('..')) {
    return `Access denied: path "${relativePath}" is outside the workspace`
  }

  const sensitivePatterns = ['.env', '.pem', '.key', 'id_rsa', 'id_ed25519', '.npmrc']
  const fileName = relativePath.split('/').pop()?.split('\\').pop() ?? ''
  if (sensitivePatterns.some(p => fileName.includes(p))) {
    return `Access denied: sensitive file pattern detected`
  }

  try {
    const content = await readFile(normalized, 'utf-8')
    if (content.length <= maxLength) {
      return content
    }
    return content.slice(0, maxLength) + `\n\n[... truncated at ${maxLength} chars, file has ${content.length} total chars]`
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return `File not found: ${relativePath}`
    }
    return `Failed to read file: ${err instanceof Error ? err.message : String(err)}`
  }
}
