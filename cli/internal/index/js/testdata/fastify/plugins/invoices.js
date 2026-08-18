export default async function invoices(fastify) {
  fastify.get('/invoices', listInvoices)
}
