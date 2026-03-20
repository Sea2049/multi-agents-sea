import type { FastifyInstance } from 'fastify'
import { getSkillRegistry } from '../skills/registry.js'

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/skills', async (_request, reply) => {
    const registry = getSkillRegistry()
    return reply.send({
      version: registry.getVersion(),
      skills: registry.list().map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version ?? null,
        source: skill.source,
        mode: skill.metadata.mode ?? 'prompt-only',
        homepage: skill.metadata.homepage ?? null,
        enabled: skill.enabled,
        trusted: skill.trusted,
        eligible: skill.eligible,
        disabledReasons: skill.disabledReasons,
      })),
    })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/enable', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setEnabled(request.params.id, true)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, enabled: skill.enabled })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/disable', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setEnabled(request.params.id, false)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, enabled: skill.enabled })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/trust', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setTrusted(request.params.id, true)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, trusted: skill.trusted })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/untrust', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setTrusted(request.params.id, false)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, trusted: skill.trusted })
  })
}
