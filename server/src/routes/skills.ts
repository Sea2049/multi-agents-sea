import type { FastifyInstance } from 'fastify'
import { getSkillRegistry } from '../skills/registry.js'
import {
  installRemoteSkill,
  uninstallRemoteSkill,
  listRemoteSkills,
  checkRemoteSkillUpdate,
} from '../skills/remote-installer.js'

const SKILLS_INDEX_URL = process.env['SEA_SKILLS_INDEX_URL']
  ?? 'https://raw.githubusercontent.com/multi-agents-sea/skills-index/main/skills-index.json'

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

  // ─── Remote Skill Market ──────────────────────────────────────────────────

  app.get('/skills/index', async (_request, reply) => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      try {
        const res = await fetch(SKILLS_INDEX_URL, { signal: controller.signal })
        if (!res.ok) {
          return reply.status(502).send({ error: `Failed to fetch skills index: HTTP ${res.status}` })
        }
        const data = await res.json()
        return reply.send(data)
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      return reply.status(502).send({ error: `Failed to fetch skills index: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.get('/skills/remote', async (_request, reply) => {
    return reply.send(listRemoteSkills())
  })

  app.post<{ Body: { url?: string } }>('/skills/remote/install', async (request, reply) => {
    const { url } = request.body ?? {}
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'Body must include a "url" string' })
    }

    try {
      const result = await installRemoteSkill(url)
      await getSkillRegistry().reload()
      return reply.send(result)
    } catch (err) {
      return reply.status(500).send({ error: `Install failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.post<{ Params: { id: string } }>('/skills/remote/:id/update', async (request, reply) => {
    const skillId = request.params.id
    const remoteSkills = listRemoteSkills()
    const existing = remoteSkills.find((s) => s.id === skillId)
    if (!existing) {
      return reply.status(404).send({ error: `Remote skill not found: ${skillId}` })
    }

    try {
      const result = await installRemoteSkill(existing.url)
      await getSkillRegistry().reload()
      return reply.send(result)
    } catch (err) {
      return reply.status(500).send({ error: `Update failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.delete<{ Params: { id: string } }>('/skills/remote/:id', async (request, reply) => {
    const skillId = request.params.id
    try {
      await uninstallRemoteSkill(skillId)
      await getSkillRegistry().reload()
      return reply.status(204).send()
    } catch (err) {
      return reply.status(500).send({ error: `Uninstall failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.get('/skills/remote/check-updates', async (_request, reply) => {
    const remoteSkills = listRemoteSkills()
    const results = await Promise.all(
      remoteSkills.map(async (skill) => {
        const check = await checkRemoteSkillUpdate(skill.id)
        return { id: skill.id, name: skill.name, ...check }
      }),
    )
    return reply.send(results)
  })
}
