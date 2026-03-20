import { execFile } from 'node:child_process'

export interface CommandExecutionOptions {
  cwd?: string
  timeoutMs?: number
}

export interface CommandExecutionResult {
  stdout: string
  stderr: string
}

export type CommandExecutor = (
  command: string,
  args: string[],
  options?: CommandExecutionOptions,
) => Promise<CommandExecutionResult>

export interface DockerAvailability {
  available: boolean
  message?: string
}

type CommandExecutionError = NodeJS.ErrnoException & {
  stdout?: string
  stderr?: string
}

const DOCKER_CHECK_TIMEOUT_MS = 5_000

export const defaultCommandExecutor: CommandExecutor = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }) as CommandExecutionError)
          return
        }

        resolve({ stdout, stderr })
      },
    )
  })

let dockerCheckExecutor: CommandExecutor = defaultCommandExecutor

export function setDockerCheckExecutor(executor: CommandExecutor): void {
  dockerCheckExecutor = executor
}

export function resetDockerCheckExecutor(): void {
  dockerCheckExecutor = defaultCommandExecutor
}

export async function checkDockerAvailable(): Promise<DockerAvailability> {
  try {
    await dockerCheckExecutor('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: DOCKER_CHECK_TIMEOUT_MS,
    })

    return { available: true }
  } catch (error) {
    return {
      available: false,
      message: formatDockerCheckError(error),
    }
  }
}

function formatDockerCheckError(error: unknown): string {
  const commandError = error as CommandExecutionError
  const stderr = commandError.stderr?.trim()
  if (stderr) {
    return stderr
  }

  if (commandError.code === 'ENOENT') {
    return 'Docker CLI was not found in PATH.'
  }

  if (commandError.message) {
    return commandError.message
  }

  return 'Unknown Docker error.'
}
