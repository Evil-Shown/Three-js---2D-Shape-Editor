import { ParameterSerializer } from '../export/ParameterSerializer.js'

const serializer = new ParameterSerializer()

/**
 * @param {object} payload  Exported shape JSON (from DB or file)
 * @param {import('../store/GeometryStore').GeometryStore} store
 * @param {import('../store/ParameterStore').ParameterStore} paramStore
 * @returns {{ ok: boolean, reason?: string }}
 */
export function applyShapePayloadToStores(payload, store, paramStore) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'Invalid payload' }
  }

  const edges = Array.isArray(payload.edges) ? payload.edges : []
  if (edges.length === 0) {
    return { ok: false, reason: 'No drawable edges (parametric-only shapes need evaluated geometry)' }
  }

  serializer.deserialize(payload, paramStore)
  store.importEdgesFromPayload(edges)
  return { ok: true }
}
