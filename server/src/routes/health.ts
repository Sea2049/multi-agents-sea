import type { FastifyInstance } from 'fastify'

const SERVER_START_TIME = Date.now()

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      version: '1.0.0',
      uptime: (Date.now() - SERVER_START_TIME) / 1000,
    })
  })
}
