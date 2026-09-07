import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { PORT } from './config.js'
import { initKeys } from './keys.js'
import authorize from './routes/authorize.js'
import discovery from './routes/discovery.js'
import jwks from './routes/jwks.js'
import logout from './routes/logout.js'
import token from './routes/token.js'
import userinfo from './routes/userinfo.js'

await initKeys()

const app = new Hono()
app.route('/', discovery)
app.route('/', jwks)
app.route('/', authorize)
app.route('/', token)
app.route('/', userinfo)
app.route('/', logout)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`nobizid (gbizid dummy OP) listening on http://localhost:${info.port}`)
})
