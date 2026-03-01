import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModel } from './loadModel'
import { loadAnimations, AnimationController } from './animation'

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
const animSelect = document.getElementById('anim-select') as HTMLSelectElement

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
let animController: AnimationController | null = null
let loading = false
let lastFrameTime = performance.now()

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
  // Force world matrix update so bounding box is accurate
  group.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  // Shift model so its center sits at X=0, Z=0 (keep Y as-is so feet stay on ground)
  group.position.x = -center.x
  group.position.z = -center.z

  const targetY = center.y
  controls.target.set(0, targetY, 0)

  // Position camera to fit the model (front view)
  const maxDim = Math.max(size.x, size.y, size.z)
  const dist = maxDim * 1.8
  camera.position.set(dist, targetY, 0)
  controls.update()
}

function populateAnimDropdown(controller: AnimationController) {
  animSelect.innerHTML = ''
  const anims = controller.getAnimationList()

  // Group by animId, show only first sub-variation by default
  const seen = new Set<number>()
  for (const anim of anims) {
    if (anim.duration === 0) continue // skip zero-duration sequences
    if (anim.subAnimId > 0 && seen.has(anim.animId)) continue
    seen.add(anim.animId)

    const opt = document.createElement('option')
    opt.value = String(anim.seqIndex)
    opt.textContent = anim.label
    animSelect.appendChild(opt)
  }

  // Default to Stand (animId 0)
  const standIdx = anims.findIndex(a => a.animId === 0)
  if (standIdx >= 0) {
    animSelect.value = String(standIdx)
  }
}

async function switchModel() {
  if (loading) return
  loading = true

  const slug = getModelSlug()
  const modelDir = `/models/${slug}`

  try {
    const [loaded, animData] = await Promise.all([
      loadModel(modelDir),
      loadAnimations(modelDir),
    ])

    if (currentModel) {
      disposeModel(currentModel)
    }

    scene.add(loaded.group)
    currentModel = loaded.group

    animController = new AnimationController(animData, loaded.boneData, loaded.bones)
    populateAnimDropdown(animController)

    // Set initial animation to Stand
    const standIdx = animData.sequences.findIndex(s => s.animId === 0)
    if (standIdx >= 0) {
      animController.setSequence(standIdx)
    }

    frameCameraOnModel(loaded.group)
  } catch (err) {
    console.error(`Failed to load model ${slug}:`, err)
  } finally {
    loading = false
  }
}

animSelect.addEventListener('change', () => {
  if (animController) {
    animController.setSequence(parseInt(animSelect.value, 10))
  }
})

raceSelect.addEventListener('change', switchModel)
genderSelect.addEventListener('change', switchModel)

// Load initial model
switchModel()

function animate() {
  const now = performance.now()
  const delta = now - lastFrameTime
  lastFrameTime = now

  if (animController) {
    animController.update(delta)
  }

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
