// Central environment configuration (12-factor style).
// Validates critical production settings when NODE_ENV=production.

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

function parseIntEnv(name, fallback) {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function parseBool(name, fallback = false) {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'

const jwtSecret = process.env.JWT_SECRET || ''
const authDisabled = parseBool('AUTH_DISABLED', !isProd && !jwtSecret)

if (isProd && !authDisabled && !jwtSecret) {
  console.warn('[config] WARNING: JWT_SECRET is required when AUTH_DISABLED is false in production.')
}

module.exports = {
  nodeEnv,
  isProd,
  port: parseIntEnv('PORT', 3001),

  // Default allowlist covers our dev surfaces:
  //   5173  - Vite (gsap-editor frontend)
  //   8090  - Opti-Shapes (Vite) — calls our /api/shapes to sync custom-shape deletes
  //   3000  - occasional CRA-style dev
  // Override with CORS_ORIGIN=<comma-separated list> in .env when deploying.
  corsOrigins: (
    process.env.CORS_ORIGIN ||
    'http://localhost:5173,http://localhost:8090,http://127.0.0.1:5173,http://127.0.0.1:8090,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseIntEnv('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gsap_editor',
    connectionLimit: parseIntEnv('DB_POOL_LIMIT', 10),
  },

  redis: {
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${parseIntEnv('REDIS_PORT', 6379)}`,
  },

  /** Redis list key consumed by the Java worker (BRPOP). */
  javaJobListKey: process.env.SHAPE_JOB_LIST_KEY || 'gsap:shape-processing:jobs',

  jwt: {
    secret: jwtSecret,
    /** Claim names your ERP puts in the JWT payload (adjust per IdP). */
    claims: {
      userId: process.env.JWT_CLAIM_USER_ID || 'sub',
      organizationId: process.env.JWT_CLAIM_ORG_ID || 'organization_id',
      projectId: process.env.JWT_CLAIM_PROJECT_ID || 'project_id',
    },
    authDisabled,
  },

  bullmq: {
    /** Internal worker completes jobs immediately; Java performs real processing via the Redis list. */
    enableAckWorker: parseBool('BULLMQ_ENABLE_ACK_WORKER', true),
    queueName: process.env.BULLMQ_SHAPE_QUEUE || 'shape-processing',
  },

  /** Shapes-service base URL used to sync custom-shape deletes with Opti library. */
  shapesServiceBaseUrl: process.env.SHAPES_SERVICE_BASE_URL || 'http://localhost:8092',
}
