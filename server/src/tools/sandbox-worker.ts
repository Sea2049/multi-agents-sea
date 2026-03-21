import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'

interface WorkerData {
  handlerPath: string
  input: Record<string, unknown>
  context: { skillId: string; toolName: string; workspaceRoot: string }
}

interface WorkerMessage {
  success: boolean
  result?: string
  error?: string
}

if (!isMainThread) {
  const { handlerPath, input, context } = workerData as WorkerData

  ;(async () => {
    try {
      const mod = await import(pathToFileURL(handlerPath).href) as {
        execute?: (
          input: Record<string, unknown>,
          context: { skillId: string; toolName: string; workspaceRoot: string },
        ) => Promise<string> | string
      }

      if (typeof mod.execute !== 'function') {
        throw new Error(`Handler "${handlerPath}" must export an execute() function`)
      }

      const result = await mod.execute(input, context)
      parentPort!.postMessage({ success: true, result: String(result ?? '') } satisfies WorkerMessage)
    } catch (err) {
      parentPort!.postMessage({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerMessage)
    }
  })()
}

export async function runInSandbox(
  handlerPath: string,
  input: Record<string, unknown>,
  context: { skillId: string; toolName: string; workspaceRoot: string },
  options?: { timeoutMs?: number; maxMemoryMb?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 15_000
  const maxMemoryMb = options?.maxMemoryMb ?? 128

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { handlerPath, input, context } satisfies WorkerData,
      resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
    })

    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`Skill tool timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.on('message', (msg: WorkerMessage) => {
      clearTimeout(timer)
      if (msg.success) {
        resolve(msg.result ?? '')
      } else {
        reject(new Error(msg.error ?? 'Unknown worker error'))
      }
    })

    worker.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`))
      }
    })
  })
}
