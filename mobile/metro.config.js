// Expo's default Metro config, plus a dev-only proxy for the web preview
// (`npx expo start --web`): /live-api/* is forwarded to the live API, so the
// browser talks to its own origin and needs no CORS. Native builds don't use it.
const https = require('https')
const { getDefaultConfig } = require('expo/metro-config')
const { expo } = require('./app.json')

const config = getDefaultConfig(__dirname)
const target = new URL(expo.extra.apiUrl)
const PREFIX = '/live-api'

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url.startsWith(PREFIX + '/')) return middleware(req, res, next)
    const headers = { ...req.headers, host: target.host }
    delete headers.origin
    delete headers.referer
    delete headers.cookie
    const upstream = https.request(
      { host: target.host, path: req.url.slice(PREFIX.length), method: req.method, headers },
      (live) => {
        res.writeHead(live.statusCode, live.headers)
        live.pipe(res)
      },
    )
    upstream.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `Live API unreachable: ${err.message}` }))
    })
    req.pipe(upstream)
  },
}

module.exports = config
