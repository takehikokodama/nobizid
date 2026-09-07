import { Hono } from 'hono'
import { getJwks } from '../keys.js'

const app = new Hono()

// GBizID does not publish its real jwks_uri path in the developer
// guideline PDF, only that a JWKS endpoint exists (section 3.3.3.1). We
// serve it under the same /oauth/.well-known/ prefix as discovery.
app.get('/oauth/.well-known/jwks.json', (c) => {
  return c.json(getJwks())
})

export default app
