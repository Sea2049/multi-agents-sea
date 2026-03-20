import type { FastifyInstance } from 'fastify'
import { getDb } from '../storage/db.js'
import { getProviderRegistry } from '../plugins/provider-registry.js'
import { isProviderName } from '../providers/index.js'

interface ProviderSettingRow {
  provider: string
  model: string
  endpoint: string | null
  created_at: number
  updated_at: number
}

interface SetDefaultModelBody {
  model: string
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/providers', async (_request, reply) => {
    const db = getDb()
    const registry = getProviderRegistry()
    const rows = db
      .prepare<[], ProviderSettingRow>(`SELECT * FROM provider_settings`)
      .all()

    const settingsMap = new Map(rows.map((r) => [r.provider, r]))
    const providers = registry.listManifests().map((manifest) => {
      const name = manifest.id
      const row = settingsMap.get(name)
      return {
        name,
        label: manifest.label,
        description: manifest.description,
        hint: manifest.hint,
        kind: manifest.kind,
        iconKey: manifest.iconKey,
        defaultModel: row?.model ?? null,
        configured: registry.isConfigured(name),
        settingsSchema: manifest.fields.map((field) => ({
          ...field,
          currentValue:
            field.inputType === 'secret'
              ? null
              : process.env[field.envVar]?.trim() || field.defaultValue || null,
        })),
      }
    })

    return reply.send({ providers })
  })

  app.post<{ Params: { provider: string }; Body: SetDefaultModelBody }>(
    '/settings/providers/:provider/model',
    async (request, reply) => {
      const { provider } = request.params
      const { model } = request.body

      if (!isProviderName(provider)) {
        return reply.status(400).send({
          error: `Invalid provider: "${provider}"`,
        })
      }

      if (!model?.trim()) {
        return reply.status(400).send({ error: 'model is required' })
      }

      const db = getDb()
      const now = Date.now()

      db.prepare(
        `INSERT INTO provider_settings (provider, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at`,
      ).run(provider, model.trim(), now, now)

      return reply.send({ provider, model: model.trim(), updatedAt: now })
    },
  )

  app.get<{ Params: { provider: string } }>(
    '/settings/providers/:provider/models',
    async (request, reply) => {
      const { provider } = request.params

      if (!isProviderName(provider)) {
        return reply.status(400).send({
          error: `Invalid provider: "${provider}"`,
        })
      }

      try {
        const llmProvider = getProviderRegistry().createFromEnv(provider)
        const models = await llmProvider.models()
        return reply.send({ provider, models })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list models'
        return reply.status(500).send({ error: message })
      }
    },
  )

  app.post<{ Params: { provider: string } }>(
    '/settings/providers/:provider/validate',
    async (request, reply) => {
      const { provider } = request.params

      if (!isProviderName(provider)) {
        return reply.status(400).send({
          error: `Invalid provider: "${provider}"`,
        })
      }

      try {
        const llmProvider = getProviderRegistry().createFromEnv(provider)
        const health = await llmProvider.validateCredentials()
        return reply.send(health)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Validation failed'
        return reply.send({ ok: false, error: message })
      }
    },
  )
}
