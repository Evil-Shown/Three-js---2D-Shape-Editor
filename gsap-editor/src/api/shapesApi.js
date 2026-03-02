// src/api/shapesApi.js
// Frontend API client for the GSAP Editor backend.
// The Vite dev proxy forwards /api/* to http://localhost:3001

const API_BASE = '/api'

/**
 * Save a shape JSON payload to the database.
 * @param {string} shapeName
 * @param {object} jsonData   — the full export payload object
 * @returns {Promise<{ success: boolean, shape_id: number, shape_name: string, message: string }>}
 */
export async function saveShape(shapeName, jsonData) {
  const res = await fetch(`${API_BASE}/shapes`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
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
export async function listShapes() {
  const res = await fetch(`${API_BASE}/shapes`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data.shapes
}

/**
 * Fetch next available numeric shape number from DB.
 * @returns {Promise<{ nextShapeNumber: string, suggestedClassName: string }>}
 */
export async function getNextShapeNumber() {
  const res = await fetch(`${API_BASE}/shapes/next-number`)
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
  const res = await fetch(`${API_BASE}/shapes/${id}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data.shape
}

/**
 * Delete a shape by id.
 */
export async function deleteShape(id) {
  const res = await fetch(`${API_BASE}/shapes/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
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
