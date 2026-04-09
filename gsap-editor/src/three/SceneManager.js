import * as THREE from 'three'
import { CAD } from '../theme/cadTheme.js'

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(CAD.background)

    const rect = canvas.getBoundingClientRect()
    const aspect = (rect.width || window.innerWidth) / (rect.height || window.innerHeight)
    const d = 500

    this.camera = new THREE.OrthographicCamera(
      -d * aspect, d * aspect, d, -d, 0.1, 2000
    )
    this.camera.position.set(0, 0, 500)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)

    canvas.addEventListener('contextmenu', e => e.preventDefault())

    this._animate()
  }

  _animate = () => {
    this.animationId = requestAnimationFrame(this._animate)
    this.renderer.render(this.scene, this.camera)
  }

  resize(width, height) {
    this.renderer.setSize(width, height)
  }

  dispose() {
    cancelAnimationFrame(this.animationId)
    this.renderer.dispose()
  }
}