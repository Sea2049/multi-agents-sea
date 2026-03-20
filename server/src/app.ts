import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'
import { chatRoutes } from './routes/chat.js'
import { settingsRoutes } from './routes/settings.js'
import { tasksRoutes } from './routes/tasks.js'
import { memoryRoutes } from './routes/memory.js'
import { skillsRoutes } from './routes/skills.js'
import { pipelinesRoutes } from './routes/pipelines.js'
import { loadExternalProviderPlugins } from './plugins/plugin-loader.js'
import { initProviderRegistry } from './plugins/provider-registry.js'
import { initSkillRegistry, shutdownSkillRegistry } from './skills/registry.js'

export async function buildApp(): Promise<FastifyInstance> {
  initProviderRegistry()
  await loadExternalProviderPlugins()
  await initSkillRegistry()

  const app = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'development' ? 'info' : 'warn',
    },
  })

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }

      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`), false)
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })

  await app.register(healthRoutes)
  await app.register(chatRoutes, { prefix: '/api' })
  await app.register(settingsRoutes, { prefix: '/api' })
  await app.register(tasksRoutes, { prefix: '/api' })
  await app.register(memoryRoutes, { prefix: '/api' })
  await app.register(skillsRoutes, { prefix: '/api' })
  await app.register(pipelinesRoutes, { prefix: '/api' })

  app.addHook('onClose', async () => {
    await shutdownSkillRegistry()
  })

  return app
}
