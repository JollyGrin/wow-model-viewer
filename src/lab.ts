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
const envMap = pmremGenerator.fromScene(envScene, 0.04).texture
pmremGenerator.dispose()

const envParams = { enabled: true, intensity: 0.4 }
scene.environment = envMap
scene.environmentIntensity = envParams.intensity

// --- Post-processing ---

const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.15, 0.4, 0.85,
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

// --- Per-category material params ---

type MatCategory = 'body' | 'hair' | 'item'

interface CategoryParams {
  roughness: number
  metalness: number
}

const PRESETS: Record<string, Record<MatCategory, CategoryParams>> = {
  default: {
    body: { roughness: 0.75, metalness: 0.0 },
    hair: { roughness: 0.85, metalness: 0.0 },
    item: { roughness: 0.35, metalness: 0.7 },
  },
  cloth: {
    body: { roughness: 0.85, metalness: 0.0 },
    hair: { roughness: 0.9, metalness: 0.0 },
    item: { roughness: 0.8, metalness: 0.05 },
  },
  leather: {
    body: { roughness: 0.7, metalness: 0.0 },
    hair: { roughness: 0.85, metalness: 0.0 },
    item: { roughness: 0.55, metalness: 0.15 },
  },
  plate: {
    body: { roughness: 0.65, metalness: 0.05 },
    hair: { roughness: 0.85, metalness: 0.0 },
    item: { roughness: 0.25, metalness: 0.85 },
  },
}

// Live params initialized from default preset
const catParams: Record<MatCategory, CategoryParams> = {
  body: { ...PRESETS.default.body },
  hair: { ...PRESETS.default.hair },
  item: { ...PRESETS.default.item },
}

// --- Derived texture / shader feature params ---

const derivedParams = {
  autoRoughness: false,
  roughnessStrength: 0.6,
  autoNormal: false,
  normalStrength: 1.0,
  sss: false,
  sssIntensity: 0.5,
  sssSaturation: 0.5,
}

function sssColor(saturation: number): [number, number, number] {
  return [1 - 0.1 * saturation, 1 - 0.65 * saturation, 1 - 0.8 * saturation]
}

// --- Derived texture generators ---

/**
 * Generate a roughness map from a diffuse texture using luminance inversion.
 * Bright painted highlights → low roughness (shiny).
 * Dark/muted areas → high roughness (matte).
 */
function generateRoughnessMap(diffuse: THREE.DataTexture, strength: number): THREE.DataTexture {
  const w = diffuse.image.width
  const h = diffuse.image.height
  const src = diffuse.image.data as Uint8Array
  const out = new Uint8Array(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    const r = src[i * 4] / 255
    const g = src[i * 4 + 1] / 255
    const b = src[i * 4 + 2] / 255
    const lum = 0.299 * r + 0.587 * g + 0.114 * b

    // Bright pixels (painted specular) → low roughness
    // strength 0 = uniform 0.5 roughness, strength 1 = full luminance derivation
    const roughness = Math.max(0, Math.min(1, 1.0 - lum * strength))
    const val = Math.round(roughness * 255)
    out[i * 4] = val
    out[i * 4 + 1] = val
    out[i * 4 + 2] = val
    out[i * 4 + 3] = 255
  }

  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.flipY = false
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

/**
 * Generate a normal map from diffuse using Sobel operator on luminance.
 * Base strength is baked in; visual intensity controlled via material.normalScale.
 */
function generateNormalMap(diffuse: THREE.DataTexture): THREE.DataTexture {
  const w = diffuse.image.width
  const h = diffuse.image.height
  const src = diffuse.image.data as Uint8Array
  const BASE_STRENGTH = 4.0

  // Grayscale heightmap
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255
  }

  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x

      // 3x3 Sobel neighborhood (clamp at edges)
      const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1)
      const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1)
      const tl = gray[ym * w + xm], t = gray[ym * w + x], tr = gray[ym * w + xp]
      const l = gray[y * w + xm], r = gray[y * w + xp]
      const bl = gray[yp * w + xm], b = gray[yp * w + x], br = gray[yp * w + xp]

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr)

      const nx = -dx * BASE_STRENGTH
      const ny = -dy * BASE_STRENGTH
      const nz = 1.0
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)

      out[idx * 4] = Math.round(((nx / len) * 0.5 + 0.5) * 255)
      out[idx * 4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255)
      out[idx * 4 + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255)
      out[idx * 4 + 3] = 255
    }
  }

  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.flipY = false
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

// --- Tweakpane ---

const pane = new Pane({ title: 'Shader Lab', expanded: true })
const paneEl = pane.element.parentElement
if (paneEl) {
  paneEl.style.position = 'fixed'
  paneEl.style.top = '12px'
  paneEl.style.right = '12px'
  paneEl.style.zIndex = '20'
}

// Renderer folder
const rendererFolder = pane.addFolder({ title: 'Renderer', expanded: false })
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

// Materials folder — per-category controls
const matFolder = pane.addFolder({ title: 'Materials', expanded: false })

const presetBlade = matFolder.addBlade({
  view: 'list',
  label: 'Preset',
  options: Object.keys(PRESETS).map(k => ({ text: k, value: k })),
  value: 'default',
}) as ListBladeApi<string>

const catBindings: Array<{ refresh(): void }> = []

function addCategoryFolder(cat: MatCategory, label: string) {
  const folder = matFolder.addFolder({ title: label, expanded: false })
  const rB = folder.addBinding(catParams[cat], 'roughness', { min: 0, max: 1, step: 0.01 })
  rB.on('change', () => applyMaterialParams())
  const mB = folder.addBinding(catParams[cat], 'metalness', { min: 0, max: 1, step: 0.01 })
  mB.on('change', () => applyMaterialParams())
  catBindings.push(rB, mB)
}

addCategoryFolder('body', 'Body (Skin + Armor)')
addCategoryFolder('hair', 'Hair')
addCategoryFolder('item', 'Items (Weapon/Helm/Shoulder)')

presetBlade.on('change', (ev) => {
  const p = PRESETS[ev.value]
  if (!p) return
  for (const cat of ['body', 'hair', 'item'] as MatCategory[]) {
    catParams[cat].roughness = p[cat].roughness
    catParams[cat].metalness = p[cat].metalness
  }
  catBindings.forEach(b => b.refresh())
  applyMaterialParams()
})

// Derived Maps folder
const derivedFolder = pane.addFolder({ title: 'Texture Analysis', expanded: false })

derivedFolder.addBinding(derivedParams, 'autoRoughness', { label: 'Auto Roughness' })
  .on('change', () => applyShaderFeatures())
derivedFolder.addBinding(derivedParams, 'roughnessStrength', { label: 'Roughness Strength', min: 0.1, max: 1.5, step: 0.05 })
  .on('change', () => { if (derivedParams.autoRoughness) applyShaderFeatures() })

derivedFolder.addBinding(derivedParams, 'autoNormal', { label: 'Auto Normal Map' })
  .on('change', () => applyShaderFeatures())
derivedFolder.addBinding(derivedParams, 'normalStrength', { label: 'Normal Strength', min: 0, max: 3, step: 0.05 })
  .on('change', () => {
    // normalScale can update without regenerating the texture
    if (!derivedParams.autoNormal || !currentModel) return
    currentModel.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const mat = obj.material as THREE.MeshPhysicalMaterial
      if (mat.normalMap) {
        mat.normalScale.set(derivedParams.normalStrength, derivedParams.normalStrength)
      }
    })
  })

derivedFolder.addBinding(derivedParams, 'sss', { label: 'Skin SSS' })
  .on('change', () => applyShaderFeatures())
derivedFolder.addBinding(derivedParams, 'sssIntensity', { label: 'SSS Intensity', min: 0, max: 1, step: 0.05 })
  .on('change', () => {
    if (!derivedParams.sss || !currentModel) return
    currentModel.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (obj.userData.matCategory !== 'body') return
      const mat = obj.material as THREE.MeshPhysicalMaterial
      mat.sheen = derivedParams.sssIntensity
      mat.sheenRoughness = 0.8
    })
  })
derivedFolder.addBinding(derivedParams, 'sssSaturation', { label: 'SSS Warmth', min: 0, max: 1, step: 0.05 })
  .on('change', () => {
    if (!derivedParams.sss || !currentModel) return
    currentModel.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (obj.userData.matCategory !== 'body') return
      const mat = obj.material as THREE.MeshPhysicalMaterial
      mat.sheenColor.setRGB(...sssColor(derivedParams.sssSaturation))
    })
  })

// Lighting folder
const lightFolder = pane.addFolder({ title: 'Lighting', expanded: false })
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
const envFolder = pane.addFolder({ title: 'Environment', expanded: false })
envFolder.addBinding(envParams, 'enabled', { label: 'Enable' })
  .on('change', (ev: any) => {
    scene.environment = ev.value ? envMap : null
  })
envFolder.addBinding(envParams, 'intensity', { label: 'Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { scene.environmentIntensity = ev.value })

// Post-processing folder
const postFolder = pane.addFolder({ title: 'Post-Processing', expanded: false })
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
    ssaoPass.minDistance = 0.001 / Math.max(ev.value, 0.01)
  })

const smaaParams = { enabled: true }
postFolder.addBinding(smaaParams, 'enabled', { label: 'SMAA' })
  .on('change', (ev: any) => { smaaPass.enabled = ev.value })

// --- Material classification & upgrade ---

/** Classify a mesh by scene graph position:
 *  - SkinnedMesh with Bone children → 'body'
 *  - SkinnedMesh without Bone children → 'hair'
 *  - Regular Mesh → 'item' (weapons, helmets, shoulders)
 */
function classifyMesh(mesh: THREE.Mesh): MatCategory {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const hasBoneChild = mesh.children.some(c => (c as THREE.Bone).isBone)
    return hasBoneChild ? 'body' : 'hair'
  }
  return 'item'
}

function applyMaterialParams() {
  if (!currentModel) return
  currentModel.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mat = obj.material
    if (!(mat instanceof THREE.MeshStandardMaterial)) return
    const cat = obj.userData.matCategory as MatCategory | undefined
    if (!cat) return
    const p = catParams[cat]
    mat.roughness = p.roughness
    mat.metalness = p.metalness
  })
}

/** Convert Lambert → MeshPhysicalMaterial. Uses Physical for all meshes so we can
 *  toggle sheen/SSS without swapping material types later. Physical renders
 *  identically to Standard when extra features are at zero. */
function upgradeMaterials(group: THREE.Group) {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mat = obj.material
    if (!(mat instanceof THREE.MeshLambertMaterial)) return

    const cat = classifyMesh(obj)
    obj.userData.matCategory = cat
    const p = catParams[cat]

    const phys = new THREE.MeshPhysicalMaterial({
      map: mat.map,
      color: mat.color.clone(),
      side: mat.side,
      transparent: mat.transparent,
      alphaTest: mat.alphaTest,
      depthWrite: mat.depthWrite,
      polygonOffset: mat.polygonOffset,
      polygonOffsetFactor: mat.polygonOffsetFactor,
      polygonOffsetUnits: mat.polygonOffsetUnits,
      roughness: p.roughness,
      metalness: p.metalness,
    })

    mat.dispose()
    obj.material = phys
  })
}

/**
 * Apply/remove derived texture maps and SSS based on current derivedParams.
 * Safe to call repeatedly — disposes old textures before creating new ones.
 */
function applyShaderFeatures(target?: THREE.Group) {
  const group = target || currentModel
  if (!group) return

  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mat = obj.material
    if (!(mat instanceof THREE.MeshPhysicalMaterial)) return
    const cat = obj.userData.matCategory as MatCategory
    const diffuse = mat.map

    // --- Auto roughness map ---
    if (derivedParams.autoRoughness && diffuse instanceof THREE.DataTexture) {
      if (mat.roughnessMap) mat.roughnessMap.dispose()
      mat.roughnessMap = generateRoughnessMap(diffuse, derivedParams.roughnessStrength)
    } else if (!derivedParams.autoRoughness && mat.roughnessMap) {
      mat.roughnessMap.dispose()
      mat.roughnessMap = null
    }

    // --- Auto normal map ---
    if (derivedParams.autoNormal && diffuse instanceof THREE.DataTexture) {
      // Only regenerate if no normal map exists yet (strength changes use normalScale)
      if (!mat.normalMap) {
        mat.normalMap = generateNormalMap(diffuse)
      }
      mat.normalScale.set(derivedParams.normalStrength, derivedParams.normalStrength)
    } else if (!derivedParams.autoNormal && mat.normalMap) {
      mat.normalMap.dispose()
      mat.normalMap = null
      mat.normalScale.set(1, 1)
    }

    // --- SSS (body only) ---
    if (cat === 'body' && derivedParams.sss) {
      mat.sheen = derivedParams.sssIntensity
      mat.sheenRoughness = 0.8
      mat.sheenColor.setRGB(...sssColor(derivedParams.sssSaturation))
    } else {
      mat.sheen = 0
    }

    mat.needsUpdate = true
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
        const m = obj.material as any
        if (m.map) m.map.dispose()
        if (m.roughnessMap) m.roughnessMap.dispose()
        if (m.normalMap) m.normalMap.dispose()
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

    // Upgrade Lambert → Physical, then apply derived maps
    upgradeMaterials(loaded.group)
    applyShaderFeatures(loaded.group)

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
})
