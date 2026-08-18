import express from 'express'

const customersRouter = express.Router()
const PROFILE = '/profile'

customersRouter.get('/', listCustomers)
customersRouter.get(PROFILE, getProfile)
customersRouter.post(routePath, createCustomer)

export { customersRouter }
