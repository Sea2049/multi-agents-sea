import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '../providers/types.js'
import {
  checkDockerAvailable,
  defaultCommandExecutor,
  type CommandExecutor,
  type DockerAvailability,
} from './docker-check.js'

type SupportedLanguage = 'javascript' | 'python'

interface CodeExecInput {
  language: string
  code: string
}

interface LanguageConfig {
  image: string
  fileName: string
  command: string[]
}

interface CodeExecCommandError extends NodeJS.ErrnoException {
  stdout?: string
  stderr?: string
}

export interface CodeExecDependencies {
  checkDockerAvailable: () => Promise<DockerAvailability>
  commandExecutor: CommandExecutor
}

const EXECUTION_TIMEOUT_MS = 30_000
const MAX_RESULT_CHARS = 4_000
const TEMP_DIR_PREFIX = 'multi-agents-code-exec-'

export const CODE_EXEC_DEFINITION: ToolDefinition = {
  name: 'code_exec',
  description: 'Execute short JavaScript or Python snippets inside a restricted Docker sandbox.',
  inputSchema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Programming language to execute: javascript or python' },
      code: { type: 'string', description: 'Source code to execute inside the sandbox' },
    },
    required: ['language', 'code'],
  },
}

const DEFAULT_DEPENDENCIES: CodeExecDependencies = {
  checkDockerAvailable,
  commandExecutor: defaultCommandExecutor,
}

let codeExecDependencies: CodeExecDependencies = { ...DEFAULT_DEPENDENCIES }

export function setCodeExecDependencies(overrides: Partial<CodeExecDependencies>): void {
  codeExecDependencies = {
    ...codeExecDependencies,
    ...overrides,
  }
}

export function resetCodeExecDependencies(): void {
  codeExecDependencies = { ...DEFAULT_DEPENDENCIES }
}

export async function executeCodeExec(input: CodeExecInput): Promise<string> {
  const language = normalizeLanguage(input.language)
  const code = typeof input.code === 'string' ? input.code : ''

  if (!isSupportedLanguage(language)) {
    return `code_exec error: Unsupported language "${language || 'unknown'}". Supported languages: javascript, python.`
  }

  if (!code.trim()) {
    return 'code_exec error: No code was provided to execute.'
  }

  const dockerStatus = await codeExecDependencies.checkDockerAvailable()
  if (!dockerStatus.available) {
    const message = dockerStatus.message ?? 'Please install Docker and ensure the daemon is running.'
    return `code_exec error: Docker is not available. ${message}`
  }

  const languageConfig = getLanguageConfig(language)
  const tempDir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX))
  const codeFilePath = join(tempDir, languageConfig.fileName)

  try {
    await writeFile(codeFilePath, code, 'utf8')

    const { stdout, stderr } = await codeExecDependencies.commandExecutor(
      'docker',
      buildDockerArgs(tempDir, languageConfig),
      { timeoutMs: EXECUTION_TIMEOUT_MS },
    )

    const output = formatStreams(stdout, stderr)
    const body = output || '[no output]'
    return truncateResult(`code_exec success (${language}):\n${body}`)
  } catch (error) {
    return truncateResult(`code_exec error (${language}):\n${formatExecutionError(error)}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function normalizeLanguage(language: unknown): string {
  return typeof language === 'string' ? language.trim().toLowerCase() : ''
}

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return language === 'javascript' || language === 'python'
}

function getLanguageConfig(language: SupportedLanguage): LanguageConfig {
  switch (language) {
    case 'javascript':
      return {
        image: 'node:20-alpine',
        fileName: 'main.js',
        command: ['node', '/workspace/main.js'],
      }
    case 'python':
      return {
        image: 'python:3.12-alpine',
        fileName: 'main.py',
        command: ['python', '-B', '/workspace/main.py'],
      }
    default:
      return assertNever(language)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled language: ${String(value)}`)
}

function buildDockerArgs(hostDir: string, config: LanguageConfig): string[] {
  return [
    'run',
    '--rm',
    '--network=none',
    '--memory=256m',
    '--cpus=0.5',
    '--pids-limit=64',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65532:65532',
    '--tmpfs',
    '/tmp:size=16m,noexec,nosuid',
    '-v',
    `${hostDir}:/workspace:ro`,
    '--workdir',
    '/workspace',
    config.image,
    ...config.command,
  ]
}

function formatExecutionError(error: unknown): string {
  const executionError = error as CodeExecCommandError
  const details: string[] = []

  if (isTimeoutError(executionError)) {
    details.push(`Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds.`)
  } else if (executionError.message) {
    details.push(executionError.message)
  } else {
    details.push('Execution failed for an unknown reason.')
  }

  const output = formatStreams(executionError.stdout ?? '', executionError.stderr ?? '')
  if (output) {
    details.push(output)
  }

  return details.join('\n\n')
}

function isTimeoutError(error: CodeExecCommandError): boolean {
  return error.message?.toLowerCase().includes('timed out') ?? false
}

function formatStreams(stdout: string, stderr: string): string {
  const sections: string[] = []

  if (stdout.trim()) {
    sections.push(`stdout:\n${stdout.trimEnd()}`)
  }

  if (stderr.trim()) {
    sections.push(`stderr:\n${stderr.trimEnd()}`)
  }

  return sections.join('\n\n')
}

function truncateResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) {
    return text
  }

  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n[output truncated to ${MAX_RESULT_CHARS} characters]`
}
