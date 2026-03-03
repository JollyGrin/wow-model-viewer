import * as THREE from 'three'
import { loadModel } from './loadModel'
import { loadAnimations, AnimationController } from './animation'
import { initEquipmentUI, getWeaponPath, getWeaponTexture, getArmorOptions } from './equipmentUI'

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

const TOPBAR_H = 44

// --- Adaptive grid layout ---
// Try column counts and pick the one that maximizes minimum cell dimension

interface GridLayout {
  cols: number
  rows: number
  cellW: number
  cellH: number
}

function computeGrid(areaW: number, areaH: number, count: number): GridLayout {
  let best: GridLayout = { cols: 5, rows: 2, cellW: areaW / 5, cellH: areaH / 2 }
  let bestScore = 0

  for (let cols = 2; cols <= 6; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = areaW / cols
    const cellH = areaH / rows
    // Score: minimize wasted space while keeping cells roughly square
    const minDim = Math.min(cellW, cellH)
    if (minDim > bestScore) {
      bestScore = minDim
      best = { cols, rows, cellW, cellH }
    }
  }
  return best
}

// --- Per-cell state ---

interface RaceCell {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  model: THREE.Group | null
  animController: AnimationController | null
  pivot: THREE.Group
}

const cells: RaceCell[] = []

// --- Renderer ---
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setClearColor(0x333333)
renderer.autoClear = false

// --- Build cells ---
for (let i = 0; i < RACES.length; i++) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(3, 1, 0)
  camera.lookAt(0, 0.9, 0)

  scene.add(new THREE.AmbientLight(0xfff5e6, 0.55))
  const front = new THREE.DirectionalLight(0xfff0dd, 0.75)
  front.position.set(3, 2, 0)
  scene.add(front)
  const fill = new THREE.DirectionalLight(0xffe8d0, 0.35)
  fill.position.set(-2, 1, 0)
  scene.add(fill)

  const pivot = new THREE.Group()
  scene.add(pivot)

  cells.push({ scene, camera, model: null, animController: null, pivot })
}

// --- Labels ---
const labelsDiv = document.getElementById('labels')!
const labelEls: HTMLDivElement[] = []
for (const race of RACES) {
  const el = document.createElement('div')
  el.className = 'race-label'
  el.textContent = race.label
  labelsDiv.appendChild(el)
  labelEls.push(el)
}

// --- Layout ---
let grid: GridLayout = { cols: 5, rows: 2, cellW: 100, cellH: 100 }

function getCanvasArea() {
  const w = window.innerWidth
  const h = window.innerHeight - TOPBAR_H
  return { w, h }
}

function resize() {
  const { w, h } = getCanvasArea()
  renderer.setSize(w, h)
  grid = computeGrid(w, h, RACES.length)

  for (let i = 0; i < RACES.length; i++) {
    const col = i % grid.cols
    const row = Math.floor(i / grid.cols)
    const x = col * grid.cellW
    const y = row * grid.cellH

    labelEls[i].style.left = `${x}px`
    labelEls[i].style.top = `${y + grid.cellH - 22}px`
    labelEls[i].style.width = `${grid.cellW}px`

    // Update camera aspect
    cells[i].camera.aspect = grid.cellW / grid.cellH
    cells[i].camera.updateProjectionMatrix()
  }
}
resize()
window.addEventListener('resize', resize)

// --- Dispose ---
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
}

// --- Frame camera to fit ---
function frameCameraForCell(cell: RaceCell) {
  if (!cell.model) return
  cell.pivot.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(cell.pivot)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  cell.model.position.x = -center.x
  cell.model.position.z = -center.z

  const targetY = center.y

  // Compute distance needed to fit model in the cell's viewport
  const fovRad = THREE.MathUtils.degToRad(cell.camera.fov)
  const aspect = cell.camera.aspect

  // Vertical: how far to fit height
  const distV = (size.y / 2) / Math.tan(fovRad / 2)
  // Horizontal: how far to fit width (model rotates, so use max of x/z)
  const hExtent = Math.max(size.x, size.z) / 2
  const distH = hExtent / (Math.tan(fovRad / 2) * aspect)

  const dist = Math.max(distV, distH) * 1.15 // 15% padding

  cell.camera.position.set(dist, targetY, 0)
  cell.camera.lookAt(0, targetY, 0)
}

// --- Animation dropdown ---
const animSelect = document.getElementById('anim-select') as HTMLSelectElement
let currentAnimId = 0 // default: Stand

function populateAnimDropdown(controller: AnimationController) {
  animSelect.innerHTML = ''
  const anims = controller.getAnimationList()
  const seen = new Set<number>()

  for (const anim of anims) {
    if (anim.duration === 0) continue
    if (anim.subAnimId > 0 && seen.has(anim.animId)) continue
    seen.add(anim.animId)

    const opt = document.createElement('option')
    opt.value = String(anim.animId)
    opt.textContent = anim.label
    animSelect.appendChild(opt)
  }
  animSelect.value = String(currentAnimId)
}

function setAnimForAll(animId: number) {
  currentAnimId = animId
  for (const cell of cells) {
    if (!cell.animController) continue
    const anims = cell.animController.getAnimationList()
    const match = anims.find(a => a.animId === animId && a.subAnimId === 0)
      || anims.find(a => a.animId === animId)
    if (match) cell.animController.setSequence(match.seqIndex)
  }
}

animSelect.addEventListener('change', () => {
  setAnimForAll(parseInt(animSelect.value, 10))
})

// --- Load all models ---
let currentGender = 'male'
let loadGeneration = 0
let animDropdownPopulated = false

async function loadAllModels() {
  const gen = ++loadGeneration
  animDropdownPopulated = false

  const promises = RACES.map(async (race, i) => {
    const cell = cells[i]
    const slug = `${race.slug}-${currentGender}`
    const modelDir = `/models/${slug}`

    try {
      const [loaded, animData] = await Promise.all([
        loadModel(modelDir, {
          weapon: getWeaponPath(),
          weaponTexture: getWeaponTexture(),
          armor: getArmorOptions(),
        }),
        loadAnimations(modelDir),
      ])

      if (gen !== loadGeneration) {
        disposeModel(loaded.group)
        return
      }

      if (cell.model) {
        cell.pivot.remove(cell.model)
        disposeModel(cell.model)
      }

      cell.pivot.add(loaded.group)
      cell.model = loaded.group
      cell.animController = new AnimationController(animData, loaded.boneData, loaded.bones)

      // Populate animation dropdown from first loaded model
      if (!animDropdownPopulated) {
        populateAnimDropdown(cell.animController)
        animDropdownPopulated = true
      }

      // Set current animation
      setAnimForCell(cell, currentAnimId)
      frameCameraForCell(cell)
    } catch (err) {
      console.error(`Failed to load ${slug}:`, err)
    }
  })

  await Promise.all(promises)
}

function setAnimForCell(cell: RaceCell, animId: number) {
  if (!cell.animController) return
  const anims = cell.animController.getAnimationList()
  const match = anims.find(a => a.animId === animId && a.subAnimId === 0)
    || anims.find(a => a.animId === animId)
  if (match) cell.animController.setSequence(match.seqIndex)
}

// --- Gender toggle ---
const genderSelect = document.getElementById('gender-select') as HTMLSelectElement
const toggleBtns = document.querySelectorAll<HTMLButtonElement>('.toggle-btn')

toggleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const gender = btn.dataset.gender!
    if (gender === currentGender) return
    currentGender = gender
    toggleBtns.forEach(b => b.classList.toggle('active', b === btn))
    // Keep hidden select in sync for equipmentUI helmet filtering
    genderSelect.value = gender
    genderSelect.dispatchEvent(new Event('change'))
    loadAllModels()
  })
})

// --- Equipment panel ---
initEquipmentUI(() => loadAllModels())

// --- Render loop ---
let lastFrameTime = performance.now()
const ROTATION_SPEED = 0.3

function animate() {
  requestAnimationFrame(animate)

  const now = performance.now()
  const delta = now - lastFrameTime
  lastFrameTime = now

  const { h } = getCanvasArea()

  renderer.clear()

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const col = i % grid.cols
    const row = Math.floor(i / grid.cols)

    cell.pivot.rotation.y += ROTATION_SPEED * (delta / 1000)

    if (cell.animController) {
      cell.animController.update(delta)
    }

    // setViewport/setScissor expect CSS pixels — Three.js applies pixelRatio internally
    const x = col * grid.cellW
    const y = h - (row + 1) * grid.cellH
    const vw = grid.cellW
    const vh = grid.cellH

    renderer.setViewport(x, y, vw, vh)
    renderer.setScissor(x, y, vw, vh)
    renderer.setScissorTest(true)
    renderer.render(cell.scene, cell.camera)
  }
}

// --- Start ---
loadAllModels()
animate()
