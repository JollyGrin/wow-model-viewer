import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModel } from './loadModel'

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x333333)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(3, 1, 0)

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.9, 0)
controls.update()

// Expose for e2e test camera control
;(window as any).__camera = camera
;(window as any).__controls = controls

// Lighting — high ambient with soft directional, similar to WoW's character panel
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
scene.add(ambientLight)

const frontLight = new THREE.DirectionalLight(0xffffff, 0.5)
frontLight.position.set(3, 2, 0)
scene.add(frontLight)

const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
fillLight.position.set(-2, 1, 0)
scene.add(fillLight)

// Grid for spatial reference (hidden during visual comparison)
// const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333)
// scene.add(grid)

// Load model
loadModel('/models/human-male').then((group) => {
  scene.add(group)
}).catch((err) => {
  console.error('Failed to load model:', err)
})

function animate() {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
