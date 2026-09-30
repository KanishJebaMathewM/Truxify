import cors from 'cors'

const allowedOrigins = (process.env.CUSTOMER_WEB_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const corsOptions = {
  origin(origin, callback) {
    // Allow mobile clients, Postman and server-to-server requests
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error(`CORS origin not allowed: ${origin}`))
  },

  credentials: true,

  methods: [
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
  ],

  maxAge: 86400,

  optionsSuccessStatus: 204,
}

export const corsMiddleware = cors(corsOptions)
