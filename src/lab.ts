import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
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
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

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
keyLight.castShadow = true
keyLight.shadow.mapSize.width = 1024
keyLight.shadow.mapSize.height = 1024
keyLight.shadow.camera.near = 0.1
keyLight.shadow.camera.far = 15
keyLight.shadow.camera.left = -3
keyLight.shadow.camera.right = 3
keyLight.shadow.camera.top = 4
keyLight.shadow.camera.bottom = -1
keyLight.shadow.bias = -0.002
keyLight.shadow.normalBias = 0.02
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffe8d0, 0.35)
fillLight.position.set(-2, 1, 0)
scene.add(fillLight)

const rimLight = new THREE.DirectionalLight(0xaaccff, 0.5)
rimLight.position.set(-1, 2, -3)
scene.add(rimLight)

// --- Ground shadow plane ---

const shadowParams = { enabled: true, opacity: 0.35 }
const groundMat = new THREE.ShadowMaterial({ opacity: shadowParams.opacity })
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat)
ground.rotation.x = -Math.PI / 2
ground.position.y = 0
ground.receiveShadow = true
scene.add(ground)

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

// Vignette pass (after tone mapping)
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      float vig = 1.0 - dot(uv, uv);
      texel.rgb *= mix(1.0, smoothstep(0.0, 1.0, vig), darkness);
      gl_FragColor = texel;
    }
  `,
}
const vignettePass = new ShaderPass(VignetteShader)
vignettePass.enabled = true
composer.addPass(vignettePass)

// --- Per-category material params ---

type MatCategory = 'body' | 'hair' | 'weapon' | 'armorHeavy' | 'armorLight'

interface CategoryParams {
  roughness: number
  metalness: number
}

const catParams: Record<MatCategory, CategoryParams> = {
  body:       { roughness: 0.75, metalness: 0.0 },
  hair:       { roughness: 0.85, metalness: 0.0 },
  weapon:     { roughness: 0.30, metalness: 0.75 },
  armorHeavy: { roughness: 0.25, metalness: 0.80 },
  armorLight: { roughness: 0.65, metalness: 0.10 },
}

/** Infer armor weight class from item slug (plate/mail → heavy, leather/cloth/robe → light). */
function inferArmorClass(slug: string): 'armorHeavy' | 'armorLight' {
  const s = slug.toLowerCase()
  if (s.includes('plate') || s.includes('mail') || s.includes('chain') || s.includes('pvp') || s.includes('dk-')) return 'armorHeavy'
  return 'armorLight'
}

// --- Rim light params (shared uniforms — updating .value updates all materials) ---

const rimLightParams = {
  enabled: true,
  color: new THREE.Color(0.35, 0.55, 1.0),
  intensity: 0.7,
  power: 3.0,
}
const rimUniforms = {
  uRimColor: { value: rimLightParams.color },
  uRimIntensity: { value: rimLightParams.intensity },
  uRimPower: { value: rimLightParams.power },
  uRimEnabled: { value: 1.0 },
}

// --- Weapon enchant params ---

const enchantParams = {
  enabled: false,
  color: new THREE.Color(0.3, 0.6, 1.0),
  size: 6.0,
  speed: 2.0,
}
let enchantParticles: THREE.Points[] = []

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

const catBindings: Array<{ refresh(): void }> = []

function addCategoryFolder(cat: MatCategory, label: string) {
  const folder = matFolder.addFolder({ title: label, expanded: false })
  const rB = folder.addBinding(catParams[cat], 'roughness', { min: 0, max: 1, step: 0.01 })
  rB.on('change', () => applyMaterialParams())
  const mB = folder.addBinding(catParams[cat], 'metalness', { min: 0, max: 1, step: 0.01 })
  mB.on('change', () => applyMaterialParams())
  catBindings.push(rB, mB)
}

addCategoryFolder('body', 'Body (Skin)')
addCategoryFolder('hair', 'Hair')
addCategoryFolder('weapon', 'Weapon')
addCategoryFolder('armorHeavy', 'Plate / Mail')
addCategoryFolder('armorLight', 'Leather / Cloth')

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

const vignetteParams = { enabled: true, darkness: 1.0 }
postFolder.addBinding(vignetteParams, 'enabled', { label: 'Vignette' })
  .on('change', (ev: any) => { vignettePass.enabled = ev.value })
postFolder.addBinding(vignetteParams, 'darkness', { label: 'Vignette Darkness', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { vignettePass.uniforms.darkness.value = ev.value })

// --- Effects folder (Rim Light, Shadows, Enchant) ---

const fxFolder = pane.addFolder({ title: 'Effects', expanded: true })

// Rim Light controls
const rimFolder = fxFolder.addFolder({ title: 'Rim Light', expanded: false })
const rimTpParams = {
  enabled: rimLightParams.enabled,
  color: { r: rimLightParams.color.r, g: rimLightParams.color.g, b: rimLightParams.color.b },
  intensity: rimLightParams.intensity,
  power: rimLightParams.power,
}
rimFolder.addBinding(rimTpParams, 'enabled', { label: 'Enabled' })
  .on('change', (ev: any) => {
    rimLightParams.enabled = ev.value
    rimUniforms.uRimEnabled.value = ev.value ? 1.0 : 0.0
  })
rimFolder.addBinding(rimTpParams, 'color', { label: 'Color', color: { type: 'float' } })
  .on('change', (ev: any) => {
    rimLightParams.color.setRGB(ev.value.r, ev.value.g, ev.value.b)
  })
rimFolder.addBinding(rimTpParams, 'intensity', { label: 'Intensity', min: 0, max: 2, step: 0.05 })
  .on('change', (ev: any) => { rimUniforms.uRimIntensity.value = ev.value })
rimFolder.addBinding(rimTpParams, 'power', { label: 'Power', min: 1, max: 8, step: 0.1 })
  .on('change', (ev: any) => { rimUniforms.uRimPower.value = ev.value })

// Shadow controls
const shadowFolder = fxFolder.addFolder({ title: 'Shadows', expanded: false })
shadowFolder.addBinding(shadowParams, 'enabled', { label: 'Enabled' })
  .on('change', (ev: any) => {
    ground.visible = ev.value
    keyLight.castShadow = ev.value
  })
shadowFolder.addBinding(shadowParams, 'opacity', { label: 'Opacity', min: 0, max: 1, step: 0.05 })
  .on('change', (ev: any) => { groundMat.opacity = ev.value })

// Weapon Enchant controls
const enchantFolder = fxFolder.addFolder({ title: 'Weapon Enchant', expanded: false })
const enchantTpParams = {
  enabled: enchantParams.enabled,
  color: { r: enchantParams.color.r, g: enchantParams.color.g, b: enchantParams.color.b },
  size: enchantParams.size,
  speed: enchantParams.speed,
}
enchantFolder.addBinding(enchantTpParams, 'enabled', { label: 'Enabled' })
  .on('change', (ev: any) => {
    enchantParams.enabled = ev.value
    setupEnchantParticles(currentModel)
  })
enchantFolder.addBinding(enchantTpParams, 'color', { label: 'Color', color: { type: 'float' } })
  .on('change', (ev: any) => {
    enchantParams.color.setRGB(ev.value.r, ev.value.g, ev.value.b)
    for (const p of enchantParticles) {
      (p.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(enchantParams.color)
    }
  })
enchantFolder.addBinding(enchantTpParams, 'size', { label: 'Size', min: 1, max: 20, step: 0.5 })
  .on('change', (ev: any) => {
    enchantParams.size = ev.value
    for (const p of enchantParticles) {
      (p.material as THREE.ShaderMaterial).uniforms.uSize.value = ev.value
    }
  })
enchantFolder.addBinding(enchantTpParams, 'speed', { label: 'Speed', min: 0.5, max: 5, step: 0.1 })
  .on('change', (ev: any) => { enchantParams.speed = ev.value })

// --- Material classification & upgrade ---

/** Classify a mesh using itemType tags from loadModel + scene graph structure. */
function classifyMesh(mesh: THREE.Mesh): MatCategory {
  // Check for tagged item meshes first
  const itemType = mesh.userData.itemType as string | undefined
  if (itemType === 'weapon') return 'weapon'
  if (itemType === 'helmet' || itemType === 'shoulder') {
    const slug = (mesh.userData.itemSlug as string) || ''
    return inferArmorClass(slug)
  }
  // SkinnedMesh classification
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const hasBoneChild = mesh.children.some(c => (c as THREE.Bone).isBone)
    return hasBoneChild ? 'body' : 'hair'
  }
  // Untagged regular mesh (shield, etc.) — default to weapon
  return 'weapon'
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

/** Convert Lambert → MeshPhysicalMaterial with rim lighting injection.
 *  Uses Physical for all meshes so we can toggle sheen/SSS without swapping types. */
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

    // Inject rim lighting via onBeforeCompile (shared uniforms update all materials)
    phys.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = rimUniforms.uRimColor
      shader.uniforms.uRimIntensity = rimUniforms.uRimIntensity
      shader.uniforms.uRimPower = rimUniforms.uRimPower
      shader.uniforms.uRimEnabled = rimUniforms.uRimEnabled

      shader.fragmentShader =
        'uniform vec3 uRimColor;\nuniform float uRimIntensity;\nuniform float uRimPower;\nuniform float uRimEnabled;\n' +
        shader.fragmentShader

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `// Rim lighting
        vec3 rimVD = normalize(vViewPosition);
        float rimDot = max(dot(rimVD, normal), 0.0);
        float rimF = pow(1.0 - rimDot, uRimPower) * uRimIntensity * uRimEnabled;
        outgoingLight += uRimColor * rimF;

        #include <output_fragment>
        `,
      )
    }

    // Enable shadow casting on character/item meshes
    obj.castShadow = true

    mat.dispose()
    obj.material = phys
  })
}

// --- Weapon enchant particle system ---

function createEnchantPoints(color: THREE.Color): THREE.Points {
  const COUNT = 60
  const positions = new Float32Array(COUNT * 3)
  const phases = new Float32Array(COUNT)

  for (let i = 0; i < COUNT; i++) {
    // Random positions along weapon blade (local space)
    positions[i * 3 + 0] = (Math.random() - 0.5) * 0.2
    positions[i * 3 + 1] = (Math.random() - 0.5) * 0.2
    positions[i * 3 + 2] = Math.random() * 1.2
    phases[i] = Math.random() * Math.PI * 2
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color.clone() },
      uSize: { value: enchantParams.size },
      uSpeed: { value: enchantParams.speed },
    },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      uniform float uSize;
      uniform float uSpeed;
      varying float vAlpha;

      void main() {
        vec3 pos = position;
        float t = uTime * uSpeed + aPhase;
        pos.x += sin(t * 2.0) * 0.12;
        pos.y += cos(t * 2.0) * 0.12;
        pos.z += sin(t * 0.7) * 0.1;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = uSize * (1.0 / -mvPos.z);

        vAlpha = 0.4 + 0.6 * abs(sin(t * 1.5));
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = 1.0 - d * 2.0;
        glow = glow * glow;
        gl_FragColor = vec4(uColor * glow * 2.0, vAlpha * glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  return new THREE.Points(geom, mat)
}

function setupEnchantParticles(group: THREE.Group | null) {
  // Clean up old particles
  for (const p of enchantParticles) {
    p.parent?.remove(p)
    p.geometry.dispose()
    ;(p.material as THREE.ShaderMaterial).dispose()
  }
  enchantParticles = []

  if (!enchantParams.enabled || !group) return

  // Find weapon meshes and add particles to their parent socket
  group.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.userData.itemType === 'weapon') {
      const parent = obj.parent
      if (parent) {
        const pts = createEnchantPoints(enchantParams.color)
        parent.add(pts)
        enchantParticles.push(pts)
      }
    }
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

    // Upgrade Lambert → Physical, then apply derived maps + enchant particles
    upgradeMaterials(loaded.group)
    applyShaderFeatures(loaded.group)

    scene.add(loaded.group)
    currentModel = loaded.group

    // Setup enchant particles on weapon meshes (if enabled)
    setupEnchantParticles(loaded.group)

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

  // Update enchant particle time
  const timeSec = now / 1000
  for (const p of enchantParticles) {
    (p.material as THREE.ShaderMaterial).uniforms.uTime.value = timeSec
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
