const express = require('express')
const orders = require('./routes/orders')
const { customersRouter } = require('./routes/customers')

const app = express()

app.use(express.json())
app.use(requireAuth)
app.use('/v1/orders', orders)
app.use('/v1/customers', rateLimit, customersRouter)

app.get('/health', (req, res) => res.json({ ok: true }))
app.route('/status').get(readStatus).put(writeStatus)

app.set('trust proxy', true)
app.get('view engine')

module.exports = app
