import { access, readdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getProviderRegistry } from './provider-registry.js'
import type { ProviderManifest, ProviderPluginModule } from './types.js'

interface ProviderPluginManifestFile {
  manifest?: ProviderManifest
  entry?: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function collectManifestPaths(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) {
    return []
  }

  const entries = await readdir(rootDir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const manifestPath = join(rootDir, entry.name, 'provider-plugin.json')
    if (await pathExists(manifestPath)) {
      results.push(manifestPath)
    }
  }

  return results
}

function isValidManifest(manifest: ProviderManifest | undefined): manifest is ProviderManifest {
  return Boolean(
    manifest &&
      typeof manifest.id === 'string' &&
      typeof manifest.label === 'string' &&
      Array.isArray(manifest.fields),
  )
}

export async function loadExternalProviderPlugins(): Promise<void> {
  if (process.env['ENABLE_PROVIDER_PLUGINS'] !== '1') {
    return
  }

  const registry = getProviderRegistry()
  const roots = [
    join(process.cwd(), 'plugins', 'providers'),
    join(homedir(), '.sea', 'providers'),
  ]

  const manifestPaths = (await Promise.all(roots.map((root) => collectManifestPaths(root)))).flat()

  for (const manifestPath of manifestPaths) {
    try {
      const raw = await readFile(manifestPath, 'utf8')
      const descriptor = JSON.parse(raw) as ProviderPluginManifestFile
      if (!isValidManifest(descriptor.manifest) || typeof descriptor.entry !== 'string') {
        continue
      }

      if (!descriptor.entry.endsWith('.js') && !descriptor.entry.endsWith('.mjs')) {
        continue
      }

      const modulePath = join(dirname(manifestPath), descriptor.entry)
      const fileUrl = pathToFileURL(modulePath).href
      const loaded = await import(fileUrl) as ProviderPluginModule
      if (typeof loaded.create !== 'function') {
        continue
      }

      registry.registerProvider(descriptor.manifest, {
        create: loaded.create,
      })
    } catch (error) {
      console.warn(`[providers] failed to load plugin manifest "${manifestPath}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
