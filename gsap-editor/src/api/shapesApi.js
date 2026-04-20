// src/api/shapesApi.js
// Frontend API client for the GSAP Editor backend.
// The Vite dev proxy forwards /api/* to http://localhost:3001 (editor-local draft DB).
// `publishToLibrary` goes directly to shapes-service (ERP) at port 8092 so the shape
// becomes visible to Opti-Shapes' Simple Shape dialog.

const API_BASE = '/api'
const SHAPES_SERVICE_BASE =
  import.meta.env.VITE_SHAPES_SERVICE_URL || 'http://localhost:8092'

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  const token = import.meta.env.VITE_ERP_JWT
  const org = import.meta.env.VITE_ERP_ORG_ID
  const project = import.meta.env.VITE_ERP_PROJECT_ID
  if (token) headers.Authorization = `Bearer ${token}`
  if (org) headers['x-organization-id'] = org
  if (project) headers['x-project-id'] = project
  return headers
}

function parseOrgId() {
  const raw = import.meta.env.VITE_ERP_ORG_ID
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Save a shape JSON payload to the database.
 * @param {string} shapeName
 * @param {object} jsonData   — the full export payload object
 * @returns {Promise<{ success: boolean, shape_id: number, shape_name: string, message: string }>}
 */
export async function saveShape(shapeName, jsonData) {
  const res = await fetch(`${API_BASE}/shapes`, {
    method : 'POST',
    headers: buildHeaders(),
    body   : JSON.stringify({ shape_name: shapeName, json_data: jsonData }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `Server error ${res.status}`)
  }
  return data
}

/**
 * Fetch all saved shapes (name + id + created_at only, no heavy json_data).
 * @returns {Promise<Array<{ id: number, shape_name: string, shape_number: string|null, created_at: string }>>}
 */
export async function listShapes(query = {}) {
  const q = new URLSearchParams()
  if (query.page != null) q.set('page', String(query.page))
  if (query.limit != null) q.set('limit', String(query.limit))
  if (query.include_json) q.set('include_json', '1')
  if (query.project_id) q.set('project_id', query.project_id)
  if (query.status) q.set('status', query.status)
  const suffix = q.toString() ? `?${q}` : ''
  const res = await fetch(`${API_BASE}/shapes${suffix}`, {
    headers: buildHeaders(),
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data.shapes
}

/** List shapes with full json_data for gallery previews (uses include_json on the API). */
export async function listShapesWithPayload(limit = 100) {
  return listShapes({ limit, include_json: true, page: 1 })
}

/**
 * Fetch next available numeric shape number from DB.
 * @returns {Promise<{ nextShapeNumber: string, suggestedClassName: string }>}
 */
export async function getNextShapeNumber() {
  const res = await fetch(`${API_BASE}/shapes/next-number`, { headers: buildHeaders() })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return {
    nextShapeNumber: data.nextShapeNumber,
    suggestedClassName: data.suggestedClassName,
  }
}

/**
 * Fetch a single shape by id (includes full json_data).
 */
export async function getShape(id) {
  const res = await fetch(`${API_BASE}/shapes/${id}`, { headers: buildHeaders() })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data.shape
}

/** Lightweight status for ERP dashboards (no json_data). */
export async function getShapeStatus(id) {
  const res = await fetch(`${API_BASE}/shapes/${id}/status`, { headers: buildHeaders() })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

/**
 * Delete a shape by id.
 */
export async function deleteShape(id) {
  const res = await fetch(`${API_BASE}/shapes/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(),
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

/**
 * Replace stored JSON for an existing shape (new version row + re-queue processing).
 */
export async function updateShape(id, shapeName, jsonData) {
  const body = { json_data: jsonData }
  if (shapeName != null && shapeName !== '') body.shape_name = shapeName
  const res = await fetch(`${API_BASE}/shapes/${id}`, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || data.message || `Server error ${res.status}`)
  }
  return data
}

/** Quick health check – resolves true if server is up. */
export async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Publish a shape to the ERP shape library (shapes-service, port 8092) so it
 * appears alongside built-in shapes in Opti-Shapes' Simple Shape dialog.
 *
 * When `existingShapeNo` is provided the row at that shape number is updated
 * in place; otherwise the server auto-assigns the next runtime number (44..99).
 *
 * Network/CORS failures are surfaced as errors so the caller can decide how
 * visible to make them; the editor's local draft save is independent and
 * should already have succeeded before this is called.
 *
 * @param {object} jsonPayload        — full export payload object (the same object saved to the draft DB)
 * @param {string|null} [existingShapeNo] — optional library shapeNo returned by a previous publish of this shape
 * @returns {Promise<{ shapeNo: string, created: boolean }>}
 */
export async function publishToLibrary(jsonPayload, existingShapeNo = null) {
  if (jsonPayload == null || typeof jsonPayload !== 'object') {
    throw new Error('publishToLibrary: jsonPayload must be an object')
  }

  const body = {
    jsonDefinition: JSON.stringify(jsonPayload),
    organizationId: parseOrgId(),
  }
  if (existingShapeNo != null && String(existingShapeNo).trim() !== '') {
    body.shapeNo = String(existingShapeNo).trim()
  }

  const res = await fetch(`${SHAPES_SERVICE_BASE}/v1/library/custom-shapes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    // non-JSON response: leave data null and fall through to error handling
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Shapes-service error ${res.status}`
    throw new Error(msg)
  }

  return {
    shapeNo: data?.shapeNo != null ? String(data.shapeNo) : null,
    created: Boolean(data?.created),
  }
}
