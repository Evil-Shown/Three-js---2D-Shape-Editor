import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listShapesWithPayload } from '../api/shapesApi'
import { shapePayloadToSvg } from '../preview/shapePreviewSvg'
import './CustomShapesGallery.css'

export default function CustomShapesGallery() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
                <li key={row.id}>
                  <button
                    type="button"
                    className="sd-tile"
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
                      <span className="sd-tile__cta">Edit in CAD →</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
