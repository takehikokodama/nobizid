import { Hono } from 'hono'

const app = new Hono()

// Convenience endpoint only: the developer guideline PDF does not document
// a logout endpoint for GBizID. Modeled after nognito's dummy logout.
app.get('/logout', (c) => {
  const logoutUri = c.req.query('logout_uri')
  if (!logoutUri) {
    return c.text('invalid_request: missing logout_uri', 400)
  }
  return c.redirect(logoutUri, 302)
})

export default app
