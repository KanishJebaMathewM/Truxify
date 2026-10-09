const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'x-csrf-token'

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, item) => {
    const separatorIndex = item.indexOf('=')

    if (separatorIndex === -1) {
      return cookies
    }

    const key = item.slice(0, separatorIndex).trim()
    const value = item.slice(separatorIndex + 1).trim()

    cookies[key] = decodeURIComponent(value)

    return cookies
  }, {})
}

function generateToken() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure random token generation is unavailable')
  }

  return `${globalThis.crypto.randomUUID()}-${globalThis.crypto.randomUUID()}`
}

export function csrfTokenMiddleware(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next()
  }

  const cookies = parseCookies(req.headers.cookie)
  const cookieToken = cookies[CSRF_COOKIE_NAME]
  const headerToken = req.headers[CSRF_HEADER_NAME]

  if (
    !cookieToken ||
    !headerToken ||
    cookieToken !== headerToken
  ) {
    return res.status(403).json({
      error: 'CSRF validation failed',
      message: 'Missing or invalid CSRF token',
    })
  }

  next()
}

export function csrfTokenEndpoint(req, res) {
  const cookies = parseCookies(req.headers.cookie)
  let token = cookies[CSRF_COOKIE_NAME]

  if (!token) {
    token = generateToken()

    const cookieParts = [
      `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'SameSite=Lax',
    ]

    if (process.env.NODE_ENV === 'production') {
      cookieParts.push('Secure')
    }

    res.setHeader('Set-Cookie', cookieParts.join('; '))
  }

  res.status(200).json({
    csrfToken: token,
  })
}
