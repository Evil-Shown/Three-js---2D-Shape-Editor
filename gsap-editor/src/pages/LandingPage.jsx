import { Link } from 'react-router-dom'
import './LandingPage.css'

const OPTI_SHAPES_URL = import.meta.env.VITE_OPTI_SHAPES_URL || 'http://localhost:8090'

export default function LandingPage() {
  const handleBackToOptiShapes = () => {
    window.location.href = OPTI_SHAPES_URL
  }

  return (
    <div className="sd-landing">
      <div className="sd-landing__glow" aria-hidden />
      <div className="sd-landing__grid" aria-hidden />

      <button
        type="button"
        className="sd-landing__back"
        onClick={handleBackToOptiShapes}
        aria-label="Back to Opti-Shapes"
      >
        <span className="sd-landing__back-arrow" aria-hidden>←</span>
        <span>Back to Opti-Shapes</span>
      </button>

      <header className="sd-landing__header">
        <span className="sd-landing__badge">2D · Parametric · Three.js</span>
        <h1 className="sd-landing__title">
          <span className="sd-landing__title-accent">Shape</span> Designer
        </h1>
        <p className="sd-landing__subtitle">
          Draft precision profiles in a CAD-style workspace, export structured JSON, and curate your library of
          custom shapes—all in one place.
        </p>
      </header>

      <nav className="sd-landing__actions" aria-label="Main choices">
        <Link className="sd-card sd-card--primary" to="/editor">
          <span className="sd-card__icon" aria-hidden>◇</span>
          <span className="sd-card__label">Three.js workspace</span>
          <span className="sd-card__hint">Draw lines, arcs, parameters, and save to your database.</span>
        </Link>
        <Link className="sd-card sd-card--secondary" to="/custom-shapes">
          <span className="sd-card__icon" aria-hidden>▦</span>
          <span className="sd-card__label">Custom shapes editor</span>
          <span className="sd-card__hint">Browse saved JSON shapes, preview in a grid, open any shape to edit again.</span>
        </Link>
      </nav>

      <footer className="sd-landing__footer">
        <span>Orthographic canvas · Snap & constraints · GSAP-ready export</span>
      </footer>
    </div>
  )
}
