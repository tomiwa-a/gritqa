const { Router } = require('express')

const router = Router()

router.use(requireAuth)
router.get('/', listOrders)
router.post('/', validate, createOrder)
router.get('/:id', getOrder)
router.patch('/:id', updateOrder)
router.delete('/:id', deleteOrder)
router.all('/:id/events', streamEvents)

module.exports = router
