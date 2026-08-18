module.exports = async function (fastify, opts) {
  fastify.get('/', listOrders)
  fastify.post('/', { preHandler: requireAuth }, createOrder)
  fastify.get('/:id', getOrder)
  fastify.delete('/:id', deleteOrder)
}
