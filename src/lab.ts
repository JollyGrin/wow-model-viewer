import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Pane, type ListBladeApi } from 'tweakpane'
import { loadModel } from './loadModel'
import { loadAnimations, AnimationController } from './animation'
import { initEquipmentUI, getWeaponPath, getWeaponTexture, getArmorOptions } from './equipmentUI'

// --- Races ---

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

// --- Renderer ---

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setClearColor(0x333333)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(3, 1, 0)

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.9, 0)
controls.update()

// Expose for e2e
;(window as any).__camera = camera
;(window as any).__controls = controls

// --- Lighting ---

const hemiLight = new THREE.HemisphereLight(0x8ec5ff, 0x6b4f2a, 0.6)
scene.add(hemiLight)

const keyLight = new THREE.DirectionalLight(0xfff0dd, 0.85)
keyLight.position.set(3, 2, 0)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffe8d0, 0.35)
fillLight.position.set(-2, 1, 0)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xaaccff, 0.5)
rimLight.position.set(-1, 2, -3)
scene.add(rimLight)

// --- Environment map (procedural) ---

const pmremGenerator = new THREE.PMREMGenerator(renderer)
const envScene = new THREE.Scene()
envScene.background = new THREE.Color(0x444444)
let envMap = pmremGenerator.fromScene(envScene, 0.04).texture

const envParams = { enabled: true, intensity: 0.4 }
scene.environment = envMap
scene.environmentIntensity = envParams.intensity

// --- Post-processing ---

const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.15, // strength
  0.4,  // radius
  0.85, // threshold
)
bloomPass.enabled = true
composer.addPass(bloomPass)

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight)
ssaoPass.kernelRadius = 0.5
ssaoPass.minDistance = 0.001
ssaoPass.maxDistance = 0.1
;(ssaoPass as any).output = SSAOPass.OUTPUT.Default
ssaoPass.enabled = true
composer.addPass(ssaoPass)

const smaaPass = new SMAAPass()
smaaPass.enabled = true
composer.addPass(smaaPass)

const outputPass = new OutputPass()
composer.addPass(outputPass)

// --- Material presets ---

interface MatPreset {
  roughness: number
  metalness: number
}

const PRESETS: Record<string, MatPreset> = {
  skin:    { roughness: 0.8, metalness: 0.0 },
  cloth:   { roughness: 0.9, metalness: 0.0 },
  leather: { roughness: 0.7, metalness: 0.05 },
  plate:   { roughness: 0.35, metalness: 0.8 },
  weapon:  { roughness: 0.3, metalness: 0.9 },
}

const matParams = {
  roughness: 0.7,
  metalness: 0.0,
  preset: 'skin',
}

// --- Tweakpane ---

const pane = new Pane({ title: 'Shader Lab', expanded: true })
// Position tweakpane on right side
const paneEl = pane.element.parentElement
if (paneEl) {
  paneEl.style.position = 'fixed'
  paneEl.style.top = '12px'
  paneEl.style.right = '12px'
  paneEl.style.zIndex = '20'
}

// Renderer folder
const rendererFolder = pane.addFolder({ title: 'Renderer' })
const toneMappingOpts = {
  'ACES Filmic': THREE.ACESFilmicToneMapping,
  'Cineon': THREE.CineonToneMapping,
  'Reinhard': THREE.ReinhardToneMapping,
  'Linear': THREE.LinearToneMapping,
  'None': THREE.NoToneMapping,
}
const rendererParams = { toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.0 }
const toneMappingBlade = rendererFolder.addBlade({
  view: 'list',
  label: 'Tone Mapping',
  options: Object.entries(toneMappingOpts).map(([text, value]) => ({ text, value })),
  value: rendererParams.toneMapping,
}) as ListBladeApi<number>
toneMappingBlade.on('change', (ev) => {
  renderer.toneMapping = ev.value as THREE.ToneMapping
})
rendererFolder.addBinding(rendererParams, 'exposure', { min: 0.1, max: 3.0, step: 0.05 })
  .on('change', (ev: any) => { renderer.toneMappingExposure = ev.value })

// Materials folder
const matFolder = pane.addFolder({ title: 'Materials' })
const roughnessBinding = matFolder.addBinding(matParams, 'roughness', { min: 0, max: 1, step: 0.01 })
roughnessBinding.on('change', () => applyMaterialParams())
const metalnessBinding = matFolder.addBinding(matParams, 'metalness', { min: 0, max: 1, step: 0.01 })
metalnessBinding.on('change', () => applyMaterialParams())
const presetBlade = matFolder.addBlade({
  view: 'list',
  label: 'Preset',
  options: Object.keys(PRESETS).map(k => ({ text: k, value: k })),
  value: matParams.preset,
}) as ListBladeApi<string>
presetBlade.on('change', (ev) => {
  const p = PRESETS[ev.value]
  if (p) {
    matParams.roughness = p.roughness
    matParams.metalness = p.metalness
    roughnessBinding.refresh()
    metalnessBinding.refresh()
    applyMaterialParams()
  }
})

// Lighting folder
const lightFolder = pane.addFolder({ title: 'Lighting' })
const hemiParams = {
  skyColor: { r: 0x8e / 255, g: 0xc5 / 255, b: 0xff / 255 },
  groundColor: { r: 0x6b / 255, g: 0x4f / 255, b: 0x2a / 255 },
  intensity: 0.6,
}
lightFolder.addBinding(hemiParams, 'skyColor', { label: 'Hemi Sky', color: { type: 'float' } })
  .on('change', (ev: any) => { hemiLight.color.setRGB(ev.value.r, ev.value.g, ev.value.b) })
lightFolder.addBinding(hemiParams, 'groundColor', { label: 'Hemi Ground', color: { type: 'float' } })
  .on('change', (ev: any) => { hemiLight.groundColor.setRGB(ev.value.r, ev.value.g, ev.value.b) })
lightFolder.addBinding(hemiParams, 'intensity', { label: 'Hemi Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { hemiLight.intensity = ev.value })

const keyParams = { color: { r: 1, g: 0xf0 / 255, b: 0xdd / 255 }, intensity: 0.85 }
lightFolder.addBinding(keyParams, 'color', { label: 'Key Color', color: { type: 'float' } })
  .on('change', (ev: any) => { keyLight.color.setRGB(ev.value.r, ev.value.g, ev.value.b) })
lightFolder.addBinding(keyParams, 'intensity', { label: 'Key Intensity', min: 0, max: 3, step: 0.05 })
  .on('change', (ev: any) => { keyLight.intensity = ev.value })

const fillParams = { color: { r: 1, g: 0xe8 / 255, b: 0xd0 / 255 }, intensity: 0.35 }
lightFolder.addBinding(fillParams, 'color', { label: 'Fill Color', color: { type: 'float' } })
  .on('change', (ev: any) => { fillLight.color.setRGB(ev.value.r, ev.value.g, ev.value.b) })
lightFolder.addBinding(fillParams, 'intensity', { label: 'Fill Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { fillLight.intensity = ev.value })

const rimParams = { color: { r: 0xaa / 255, g: 0xcc / 255, b: 1 }, intensity: 0.5 }
lightFolder.addBinding(rimParams, 'color', { label: 'Rim Color', color: { type: 'float' } })
  .on('change', (ev: any) => { rimLight.color.setRGB(ev.value.r, ev.value.g, ev.value.b) })
lightFolder.addBinding(rimParams, 'intensity', { label: 'Rim Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { rimLight.intensity = ev.value })

// Environment folder
const envFolder = pane.addFolder({ title: 'Environment' })
envFolder.addBinding(envParams, 'enabled', { label: 'Enable' })
  .on('change', (ev: any) => {
    scene.environment = ev.value ? envMap : null
  })
envFolder.addBinding(envParams, 'intensity', { label: 'Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { scene.environmentIntensity = ev.value })

// Post-processing folder
const postFolder = pane.addFolder({ title: 'Post-Processing' })
const bloomParams = { enabled: true, threshold: 0.85, strength: 0.15, radius: 0.4 }
postFolder.addBinding(bloomParams, 'enabled', { label: 'Bloom' })
  .on('change', (ev: any) => { bloomPass.enabled = ev.value })
postFolder.addBinding(bloomParams, 'threshold', { label: 'Bloom Threshold', min: 0, max: 1.5, step: 0.01 })
  .on('change', (ev: any) => { bloomPass.threshold = ev.value })
postFolder.addBinding(bloomParams, 'strength', { label: 'Bloom Strength', min: 0, max: 2, step: 0.01 })
  .on('change', (ev: any) => { bloomPass.strength = ev.value })
postFolder.addBinding(bloomParams, 'radius', { label: 'Bloom Radius', min: 0, max: 1, step: 0.01 })
  .on('change', (ev: any) => { bloomPass.radius = ev.value })

const ssaoParams = { enabled: true, radius: 0.5, intensity: 1.0 }
postFolder.addBinding(ssaoParams, 'enabled', { label: 'SSAO' })
  .on('change', (ev: any) => { ssaoPass.enabled = ev.value })
postFolder.addBinding(ssaoParams, 'radius', { label: 'SSAO Radius', min: 0.01, max: 2, step: 0.01 })
  .on('change', (ev: any) => { ssaoPass.kernelRadius = ev.value })
postFolder.addBinding(ssaoParams, 'intensity', { label: 'SSAO Intensity', min: 0, max: 3, step: 0.05 })
  .on('change', (ev: any) => {
    // SSAOPass doesn't have a direct intensity param — adjust minDistance as proxy
    ssaoPass.minDistance = 0.001 / Math.max(ev.value, 0.01)
  })

const smaaParams = { enabled: true }
postFolder.addBinding(smaaParams, 'enabled', { label: 'SMAA' })
  .on('change', (ev: any) => { smaaPass.enabled = ev.value })

// --- Material swap: Lambert -> Standard ---

function applyMaterialParams() {
  if (!currentModel) return
  currentModel.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      obj.material.roughness = matParams.roughness
      obj.material.metalness = matParams.metalness
      obj.material.needsUpdate = true
    }
  })
}

function upgradeMaterials(group: THREE.Group) {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mat = obj.material
    if (!(mat instanceof THREE.MeshLambertMaterial)) return

    const std = new THREE.MeshStandardMaterial({
      map: mat.map,
      color: mat.color.clone(),
      side: mat.side,
      transparent: mat.transparent,
      alphaTest: mat.alphaTest,
      depthWrite: mat.depthWrite,
      polygonOffset: mat.polygonOffset,
      polygonOffsetFactor: mat.polygonOffsetFactor,
      polygonOffsetUnits: mat.polygonOffsetUnits,
      roughness: matParams.roughness,
      metalness: matParams.metalness,
    })

    mat.dispose()
    obj.material = std
  })
}

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
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  group.position.x = -center.x
  group.position.z = -center.z

  const targetY = center.y
  controls.target.set(0, targetY, 0)

  const maxDim = Math.max(size.x, size.y, size.z)
  const dist = maxDim * 1.8
  camera.position.set(dist, targetY, 0)
  controls.update()
}

function populateAnimDropdown(controller: AnimationController) {
  animSelect.innerHTML = ''
  const anims = controller.getAnimationList()

  const seen = new Set<number>()
  for (const anim of anims) {
    if (anim.duration === 0) continue
    if (anim.subAnimId > 0 && seen.has(anim.animId)) continue
    seen.add(anim.animId)

    const opt = document.createElement('option')
    opt.value = String(anim.seqIndex)
    opt.textContent = anim.label
    animSelect.appendChild(opt)
  }

  const standIdx = anims.findIndex(a => a.animId === 0)
  if (standIdx >= 0) {
    animSelect.value = String(standIdx)
  }
}

export async function switchModel() {
  if (loading) return
  loading = true

  const slug = getModelSlug()
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

    if (currentModel) {
      disposeModel(currentModel)
    }

    // Upgrade Lambert -> Standard before adding to scene
    upgradeMaterials(loaded.group)

    scene.add(loaded.group)
    currentModel = loaded.group

    animController = new AnimationController(animData, loaded.boneData, loaded.bones)
    populateAnimDropdown(animController)

    const standIdx = animData.sequences.findIndex((s: any) => s.animId === 0)
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

// Init equipment UI and load initial model
initEquipmentUI(switchModel)
switchModel()

// --- Render loop ---

function animate() {
  const now = performance.now()
  const delta = now - lastFrameTime
  lastFrameTime = now

  if (animController) {
    animController.update(delta)
  }

  controls.update()
  composer.render()
  requestAnimationFrame(animate)
}
animate()

window.addEventListener('resize', () => {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  bloomPass.resolution.set(w, h)
})
