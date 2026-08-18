const fastify = require('fastify')({ logger: true })
const invoices = require('./plugins/invoices')

fastify.register(require('./plugins/orders'), { prefix: '/v1/orders' })
fastify.register(invoices, { prefix: dynamicPrefix })

fastify.get('/health', async () => ({ ok: true }))
fastify.route({ method: 'GET', url: '/version', handler: version })
fastify.route({ method: ['POST', 'PUT'], url: '/config', handler: setConfig })

module.exports = fastify
