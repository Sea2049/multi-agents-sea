import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let loaded = false

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length) : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    const rawValue = normalized.slice(separatorIndex + 1).trim()
    if (!key) {
      continue
    }

    parsed[key] = stripWrappingQuotes(rawValue)
  }

  return parsed
}

function getEnvCandidates(): string[] {
  return [
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '.env'),
    resolve(__dirname, '../../../.env'),
  ]
}

export function ensureProjectEnvLoaded(): void {
  if (loaded) {
    return
  }

  loaded = true

  for (const envPath of getEnvCandidates()) {
    if (!existsSync(envPath)) {
      continue
    }

    const parsed = parseEnvFile(readFileSync(envPath, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]?.trim()) {
        process.env[key] = value
      }
    }

    return
  }
}
