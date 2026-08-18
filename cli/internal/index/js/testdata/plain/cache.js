const store = new Map()

function get(key) {
  return store.get('/orders/' + key)
}

async function fetchAll(client) {
  const res = await client.get('/v1/orders', { timeout: 500 })
  return res.data
}

function stash(cache, id) {
  cache.put('/tmp/orders', id)
  cache.delete('/tmp/orders', id)
}

module.exports = { get, fetchAll, stash }
