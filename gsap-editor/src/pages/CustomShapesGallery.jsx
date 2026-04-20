import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listShapesWithPayload, deleteShape } from '../api/shapesApi'
import { shapePayloadToSvg } from '../preview/shapePreviewSvg'
import { Toaster, toast } from '../components/Toast'
import './CustomShapesGallery.css'

export default function CustomShapesGallery() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listShapesWithPayload(120)
      setItems(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e.message || String(e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openEditor = (id) => {
    navigate(`/editor/${id}`)
  }

  const handleDelete = async (row, e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const title = row.shape_name || row.json_data?.name || `Shape #${row.id}`
    if (!window.confirm(`Delete "${title}" from the library? This cannot be undone.`)) return
    setDeletingId(row.id)
    try {
      await deleteShape(row.id)
      toast.success('Shape deleted. Remaining shape numbers were updated in the database.')
      await load()
    } catch (err) {
      toast.error(err?.message || String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="sd-gallery">
      <header className="sd-gallery__bar">
        <div className="sd-gallery__brand">
          <Link to="/" className="sd-gallery__home">
            ← Shape Designer
          </Link>
          <h1 className="sd-gallery__title">Custom shapes</h1>
        </div>
        <div className="sd-gallery__actions">
          <button type="button" className="sd-gallery__btn sd-gallery__btn--ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
          <Link to="/editor" className="sd-gallery__btn sd-gallery__btn--accent">
            New shape
          </Link>
        </div>
      </header>

      <main className="sd-gallery__main">
        {loading && <p className="sd-gallery__status">Loading shapes…</p>}
        {!loading && error && (
          <div className="sd-gallery__error">
            <p>{error}</p>
            <p className="sd-gallery__error-hint">Start the API server and ensure the database is reachable.</p>
            <button type="button" className="sd-gallery__btn sd-gallery__btn--ghost" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="sd-gallery__empty">
            <p>No saved shapes yet.</p>
            <Link to="/editor" className="sd-gallery__btn sd-gallery__btn--accent">
              Open workspace
            </Link>
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <ul className="sd-gallery__grid">
            {items.map((row) => {
              const payload = row.json_data
              const preview = payload ? shapePayloadToSvg(payload, { width: 320, height: 220, pad: 16 }) : null
              const title = row.shape_name || payload?.name || `Shape #${row.id}`
              return (
                <li key={row.id} className="sd-tile-wrap">
                  <div className="sd-tile sd-tile--card">
                    <button
                      type="button"
                      className="sd-tile__body"
                      onClick={() => openEditor(row.id)}
                      title={`Edit ${title}`}
                    >
                      <div className="sd-tile__canvas">
                        {preview ? (
                          <span
                            className="sd-tile__svg"
                            dangerouslySetInnerHTML={{ __html: preview.svg }}
                          />
                        ) : (
                          <span className="sd-tile__placeholder">No geometry preview</span>
                        )}
                      </div>
                      <div className="sd-tile__meta">
                        <span className="sd-tile__name">{title}</span>
                        {row.shape_number && (
                          <span className="sd-tile__num">#{row.shape_number}</span>
                        )}
                      </div>
                    </button>
                    <div className="sd-tile__actions">
                      <button
                        type="button"
                        className="sd-tile__cta"
                        onClick={() => openEditor(row.id)}
                        title={`Edit ${title}`}
                      >
                        Edit in CAD →
                      </button>
                      <button
                        type="button"
                        className="sd-tile__delete"
                        title={`Delete ${title}`}
                        disabled={deletingId === row.id || loading}
                        onClick={(e) => handleDelete(row, e)}
                      >
                        {deletingId === row.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
      <Toaster />
    </div>
  )
}
