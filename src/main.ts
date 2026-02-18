import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModel } from './loadModel'

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x222222)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0, 1.5, 5)

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 1, 0)
controls.update()

// Grid for spatial reference
const grid = new THREE.GridHelper(10, 10, 0x444444, 0x333333)
scene.add(grid)

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
