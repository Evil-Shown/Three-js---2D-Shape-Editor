const IORedis = require('ioredis')
const { Queue, Worker } = require('bullmq')
const config = require('../config')

let connection
let shapeQueue
let ackWorker

function getConnection() {
  if (!connection) {
    connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null })
  }
  return connection
}

function getShapeQueue() {
  if (!shapeQueue) {
    shapeQueue = new Queue(config.bullmq.queueName, { connection: getConnection() })
  }
  return shapeQueue
}

/**
 * Enqueues background processing:
 * 1) BullMQ job (retries, observability, future Node workers)
 * 2) Redis list payload for the Java worker (BRPOP)
 */
async function enqueueShapeProcessing(shapeId) {
  const conn = getConnection()
  const queue = getShapeQueue()
  const payload = JSON.stringify({ shapeId: Number(shapeId), enqueuedAt: new Date().toISOString() })

  await queue.add(
    'process',
    { shapeId: Number(shapeId) },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 4000 },
      removeOnComplete: { count: 10_000 },
      removeOnFail: { count: 5000 },
    }
  )

  await conn.rpush(config.javaJobListKey, payload)
}

/**
 * Completes BullMQ jobs immediately so the queue does not grow unbounded
 * while the Java worker performs the real pipeline (MySQL + code generation).
 */
function startAckWorkerIfEnabled() {
  if (!config.bullmq.enableAckWorker || ackWorker) return

  ackWorker = new Worker(
    config.bullmq.queueName,
    async () => ({ ok: true, delegatedTo: 'java-worker' }),
    { connection: getConnection(), concurrency: 32 }
  )
  ackWorker.on('failed', (job, err) => {
    console.error('[bullmq] ack worker job failed', job?.id, err)
  })
  console.log('[bullmq] ack worker started for queue:', config.bullmq.queueName)
}

async function shutdownQueue() {
  const closers = []
  if (ackWorker) closers.push(ackWorker.close())
  if (shapeQueue) closers.push(shapeQueue.close())
  if (connection) closers.push(connection.quit())
  await Promise.all(closers)
}

module.exports = {
  enqueueShapeProcessing,
  startAckWorkerIfEnabled,
  shutdownQueue,
  getConnection,
}
