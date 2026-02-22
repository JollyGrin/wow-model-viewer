import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModel } from './loadModel'

const RACES = [
  { label: 'Blood Elf', slug: 'blood-elf' },
  { label: 'Dwarf', slug: 'dwarf' },
  { label: 'Gnome', slug: 'gnome' },
  { label: 'Goblin', slug: 'goblin' },
  { label: 'Human', slug: 'human' },
  { label: 'Night Elf', slug: 'night-elf' },
  { label: 'Orc', slug: 'orc' },
  { label: 'Scourge', slug: 'scourge' },
  { label: 'Tauren', slug: 'tauren' },
  { label: 'Troll', slug: 'troll' },
]

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

// Lighting — warm-toned to match WoW character panel look
const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.55)
scene.add(ambientLight)

const frontLight = new THREE.DirectionalLight(0xfff0dd, 0.75)
frontLight.position.set(3, 2, 0)
scene.add(frontLight)

const fillLight = new THREE.DirectionalLight(0xffe8d0, 0.35)
fillLight.position.set(-2, 1, 0)
scene.add(fillLight)

// --- Dropdown UI ---

const raceSelect = document.getElementById('race-select') as HTMLSelectElement
const genderSelect = document.getElementById('gender-select') as HTMLSelectElement

for (const race of RACES) {
  const opt = document.createElement('option')
  opt.value = race.slug
  opt.textContent = race.label
  raceSelect.appendChild(opt)
}

// Default to Human Male
raceSelect.value = 'human'
genderSelect.value = 'male'

// --- Model management ---

let currentModel: THREE.Group | null = null
let loading = false

function getModelSlug(): string {
  return `${raceSelect.value}-${genderSelect.value}`
}

function disposeModel(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (obj.material instanceof THREE.Material) {
        if ((obj.material as any).map) (obj.material as any).map.dispose()
        obj.material.dispose()
      }
    }
  })
  scene.remove(group)
}

function frameCameraOnModel(group: THREE.Group) {
  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  controls.target.copy(center)

  // Position camera to fit the model (front view)
  const maxDim = Math.max(size.x, size.y, size.z)
  const dist = maxDim * 1.8
  camera.position.set(center.x + dist, center.y, center.z)
  controls.update()
}

async function switchModel() {
  if (loading) return
  loading = true

  const slug = getModelSlug()

  try {
    const group = await loadModel(`/models/${slug}`)

    if (currentModel) {
      disposeModel(currentModel)
    }

    scene.add(group)
    currentModel = group
    frameCameraOnModel(group)
  } catch (err) {
    console.error(`Failed to load model ${slug}:`, err)
  } finally {
    loading = false
  }
}

raceSelect.addEventListener('change', switchModel)
genderSelect.addEventListener('change', switchModel)

// Load initial model
switchModel()

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
