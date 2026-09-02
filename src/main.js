import * as THREE from "three";
import SmilesDrawer from "smiles-drawer";
import { clampCameraRadius, zoomRadiusFromPinch } from "./camera-controls.js";
import { factReference, moleculeBadges } from "./molecule-presentation.js";
import "./styles/app.css";

const app = document.querySelector("#app");
const loading = document.querySelector("#loading");
const searchInput = document.querySelector("#search-input");
const suggestions = document.querySelector("#suggestions");
const legend = document.querySelector("#legend");
const toggleAllButton = document.querySelector("#toggle-all");
const locus = document.querySelector("#locus");
const resetButton = document.querySelector("#reset-view");

const state = {
  galaxies: [],
  molecules: [],
  searchIndex: [],
  visibleFamilies: new Set(),
  selected: null,
  target: new THREE.Vector3(0, 0, 0),
  cameraRadius: 480,
  yaw: 0.72,
  pitch: 0.26,
  pointer: new THREE.Vector2(),
  dragging: false,
  activePointers: new Map(),
  pinchDistance: 0,
  suppressClickUntil: 0,
  lastPointer: { x: 0, y: 0 },
  fly: null,
  legendItems: new Map(),
  ringPulse: 0,
  markerVisible: false,
  system: null,
  systemTime: 0,
  elapsed: 0
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04050d, 0.002);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1400);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x04050d, 1);
app.append(renderer.domElement);

const raycaster = new THREE.Raycaster();
const galaxyGroup = new THREE.Group();
scene.add(galaxyGroup);

const starField = createStarField();
scene.add(starField);

// Marker that loops a soft sonar-style pulse at a molecule's exact position
// while it's selected, billboarded to face the camera, so the user can
// keep spotting which star they picked inside a busy cluster.
const selectionRing = new THREE.Mesh(
  new THREE.RingGeometry(1.6, 1.9, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false })
);
const selectionCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
);
scene.add(selectionRing);
scene.add(selectionCore);

const glowTexture = createGlowTexture();
// Off families are dimmed to near-white via uDim rather than hidden, so toggling
// a galaxy off behaves like a switch (still visible, just desaturated) instead
// of disappearing entirely -- matching the legend switches in the original
// chemical-universe.html prototype.
const DIM_COLOR = new THREE.Color(0.86, 0.88, 0.95);
const REVEAL_START = 90;
const REVEAL_FULL = 25;
// Cube root compresses the dataset's wide MW range (~14-5200 g/mol) into a
// gentle size curve -- molecular volume scales roughly with mass, so radius
// scales roughly with mass^(1/3). Normalized against the dataset's median MW
// so a typical molecule renders at the base size, clamped so outliers don't
// vanish or dominate.
const SIZE_REFERENCE_MW_CBRT = Math.cbrt(300);
const MARKER_PULSE_PERIOD = 1.4;
const MARKER_MAX_OPACITY = 0.45;
// Star-system view: entering requires a deliberate zoom-in past this radius --
// fly-to parks at radius 15, so the system only appears once the user scrolls
// closer. It becomes a "sun" with min(hbd, MAX_PLANETS) orbiting planets, and
// zooming back out past the same threshold dismantles it.
const SYSTEM_ENTER_RADIUS = 12;
const MAX_PLANETS = 12;
const SYSTEM_BACKGROUND_FADE = 0.22;
const systemGroup = new THREE.Group();
scene.add(systemGroup);
let lastFrameTime = performance.now();

await boot();
animate();

async function boot() {
  const universe = await fetchJson("./datasets/demo/universe.json");
  const galaxies = await Promise.all(universe.galaxies.map((galaxy) => fetchJson(`./datasets/demo/galaxies/${galaxy.id}.json`)));

  // The public dataset strips derivable fields to save bytes; rebuild them
  // here: per-molecule galaxy name, PubChem source label/URL from the bare
  // CID, and the placeholder fact.
  for (const galaxy of galaxies) {
    for (const molecule of galaxy.molecules) {
      molecule.galaxy = galaxy.name;
      if (molecule.cid != null) {
        molecule.sourceId = `PubChem CID ${molecule.cid}`;
        molecule.sourceUrl = `https://pubchem.ncbi.nlm.nih.gov/compound/${molecule.cid}`;
      }
      // Capture "has a real featured fact" before the placeholder overwrites it,
      // so the star field can make these molecules twinkle as discovery beacons.
      molecule.hasFact = Boolean(molecule.fact);
      if (!molecule.fact) molecule.fact = "Fact pending verification.";
    }
  }

  state.galaxies = galaxies;
  state.visibleFamilies = new Set(galaxies.map((galaxy) => galaxy.name));
  state.molecules = galaxies.flatMap((galaxy) => galaxy.molecules.map((molecule, index) => ({ ...molecule, galaxyId: galaxy.id, localIndex: index })));
  // Search index is derived from the loaded molecules instead of shipping a
  // separate 400KB search-index.json that duplicates the same fields.
  state.searchIndex = state.molecules.map((molecule) => ({
    id: molecule.id,
    name: molecule.name,
    galaxy: molecule.galaxy,
    recordType: molecule.recordType
  }));

  document.querySelector("#molecule-count").textContent = universe.moleculeCount.toLocaleString();
  document.querySelector("#reference-count").textContent = universe.referenceCount.toLocaleString();
  document.querySelector("#galaxy-count").textContent = universe.galaxies.length.toLocaleString();

  renderGalaxies(galaxies);
  renderLegend(galaxies);
  bindEvents();
  loading.classList.add("done");
}

function sizeForMolecularWeight(molecularWeight, baseSize) {
  if (!molecularWeight) return baseSize;
  const multiplier = Math.cbrt(molecularWeight) / SIZE_REFERENCE_MW_CBRT;
  return baseSize * Math.max(0.5, Math.min(2.2, multiplier));
}

function renderGalaxies(galaxies) {
  for (const galaxy of galaxies) {
    const positions = new Float32Array(galaxy.molecules.length * 3);
    const colors = new Float32Array(galaxy.molecules.length * 3);
    const sizes = new Float32Array(galaxy.molecules.length);
    const alphas = new Float32Array(galaxy.molecules.length);
    const twinkles = new Float32Array(galaxy.molecules.length);
    const color = new THREE.Color(galaxy.color);

    galaxy.molecules.forEach((molecule, index) => {
      positions[index * 3] = molecule.position.x;
      positions[index * 3 + 1] = molecule.position.y;
      positions[index * 3 + 2] = molecule.position.z;
      const tint = molecule.recordType === "reference" ? 1 : 0.6;
      colors[index * 3] = color.r * tint;
      colors[index * 3 + 1] = color.g * tint;
      colors[index * 3 + 2] = color.b * tint;
      const baseSize = molecule.recordType === "reference" ? 2.4 : 1.3;
      sizes[index] = sizeForMolecularWeight(molecule.molecularWeight, baseSize);
      alphas[index] = molecule.recordType === "reference" ? 1 : 0.85;
      // Molecules with a verified featured fact twinkle to advertise their story.
      twinkles[index] = molecule.hasFact ? 1 : 0;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
    const material = createPointsMaterial();
    const points = new THREE.Points(geometry, material);
    points.userData = { galaxyId: galaxy.id, galaxyName: galaxy.name, molecules: galaxy.molecules };
    galaxy.points = points;
    galaxyGroup.add(points);

    const haze = createGalaxyHaze(galaxy);
    galaxy.haze = haze;
    galaxyGroup.add(haze);
  }
}

function createGalaxyHaze(galaxy) {
  const hazePoints = galaxy.haze ?? [];
  const positions = new Float32Array(hazePoints.length * 3);
  const colors = new Float32Array(hazePoints.length * 3);
  const sizes = new Float32Array(hazePoints.length);
  const alphas = new Float32Array(hazePoints.length).fill(0.4);
  const color = new THREE.Color(galaxy.color);

  hazePoints.forEach((point, index) => {
    positions[index * 3] = point.position.x;
    positions[index * 3 + 1] = point.position.y;
    positions[index * 3 + 2] = point.position.z;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    sizes[index] = point.size;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
  return new THREE.Points(geometry, createHazeMaterial());
}

// uReveal is 0 far from a galaxy's center and 1 once the camera is inside it
// (driven by updateGalaxyReveal each frame). Molecule points grow and brighten
// as you approach; the haze cloud fades out so individual stars read clearly
// instead of a flat cloud -- matching the LOD crossfade in the original
// chemical-universe.html prototype.
function createPointsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: glowTexture },
      uDim: { value: 0 },
      dimColor: { value: DIM_COLOR },
      uReveal: { value: 0 },
      uSystemFade: { value: 1 },
      uTime: { value: 0 }
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute float aAlpha;
      attribute float aTwinkle;
      uniform float uDim;
      uniform float uReveal;
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;
      varying float vSpark;
      // Cheap stable per-star hash so twinkles desync instead of pulsing in unison.
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      void main() {
        vColor = color;
        vAlpha = aAlpha * (0.55 + 0.45 * uReveal);
        float seed = hash(position);
        float seed2 = hash(position * 1.31 + 7.7);
        // Each twinkling star gets its own phase and a slightly different speed.
        float speed = 2.2 + seed * 2.6;
        float wave = 0.5 + 0.5 * sin(uTime * speed + seed * 6.2831853);
        vTwinkle = aTwinkle * wave;
        // A minority of fact stars occasionally throw a sharp diamond glint: a
        // slow cycle raised to a high power collapses into a brief narrow spike.
        float sparkStar = step(0.8, seed2);
        float flashSpeed = 0.9 + seed2 * 0.7;
        float flashWave = 0.5 + 0.5 * sin(uTime * flashSpeed + seed2 * 6.2831853);
        vSpark = aTwinkle * sparkStar * pow(flashWave, 60.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dimScale = mix(1.0, 0.65, uDim);
        float revealScale = mix(0.34, 1.0, uReveal);
        // Grow the point on the bright side of its cycle; the glint pops harder.
        float twinkleScale = 1.0 + vTwinkle * 0.55 + vSpark * 1.8;
        gl_PointSize = size * dimScale * revealScale * twinkleScale * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D tex;
      uniform float uDim;
      uniform vec3 dimColor;
      uniform float uSystemFade;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vTwinkle;
      varying float vSpark;
      void main() {
        vec4 tex4 = texture2D(tex, gl_PointCoord);
        vec3 finalColor = mix(vColor, dimColor, uDim);
        // Push the crest of the twinkle toward white so it reads as a starlight flare.
        finalColor += vTwinkle * mix(vColor, vec3(1.0), 0.6) * 0.45;
        // The diamond glint blows out to pure white for its brief spike.
        finalColor += vSpark * vec3(1.0) * 1.3;
        float alphaScale = mix(1.0, 0.55, uDim);
        gl_FragColor = vec4(finalColor, 1.0) * tex4 * vAlpha * alphaScale * uSystemFade;
        if (gl_FragColor.a < 0.02) discard;
      }
    `
  });
}

function createHazeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: glowTexture },
      uDim: { value: 0 },
      dimColor: { value: DIM_COLOR },
      uReveal: { value: 0 },
      uSystemFade: { value: 1 }
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute float aAlpha;
      uniform float uReveal;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float revealScale = 1.0 - 0.35 * uReveal;
        gl_PointSize = size * revealScale * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D tex;
      uniform float uDim;
      uniform vec3 dimColor;
      uniform float uReveal;
      uniform float uSystemFade;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 tex4 = texture2D(tex, gl_PointCoord);
        vec3 finalColor = mix(vColor, dimColor, uDim);
        float revealFade = mix(1.0, 0.16, uReveal);
        float dimFade = mix(1.0, 0.55, uDim);
        gl_FragColor = vec4(finalColor, 1.0) * tex4 * vAlpha * revealFade * dimFade * uSystemFade;
        if (gl_FragColor.a < 0.02) discard;
      }
    `
  });
}

function createGlowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function renderLegend(galaxies) {
  for (const galaxy of galaxies) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.style.color = galaxy.color;

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "legend-name";
    nameButton.title = `Fly to ${galaxy.name}`;
    nameButton.innerHTML = `<span class="swatch"></span><span>${galaxy.name}</span>`;
    nameButton.addEventListener("click", () => flyToGalaxy(galaxy));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "legend-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", "true");
    toggle.setAttribute("aria-label", `Toggle ${galaxy.name} visibility`);
    toggle.innerHTML = `<span class="legend-toggle-knob"></span>`;
    toggle.addEventListener("click", () => toggleGalaxy(galaxy.name, item, toggle));

    item.append(nameButton, toggle);
    legend.append(item);
    state.legendItems.set(galaxy.name, item);
  }
}

function toggleGalaxy(name, item, toggle) {
  if (state.visibleFamilies.has(name)) {
    state.visibleFamilies.delete(name);
    item.classList.add("off");
    toggle.setAttribute("aria-checked", "false");
  } else {
    state.visibleFamilies.add(name);
    item.classList.remove("off");
    toggle.setAttribute("aria-checked", "true");
  }
  syncGalaxyDimming();
}

// Clicking a legend name flies the camera to that galaxy's center without
// selecting a specific molecule -- a wide enough radius to see the whole
// cluster, past the point the haze starts thinning out.
function flyToGalaxy(galaxy) {
  deselectMolecule();
  state.fly = {
    t: 0,
    from: state.target.clone(),
    fromRadius: state.cameraRadius,
    toTarget: new THREE.Vector3(galaxy.center.x, galaxy.center.y, galaxy.center.z),
    toRadius: 55
  };
  locus.innerHTML = `focus: <b>${galaxy.name}</b>`;
}

// Off families stay in the scene as dim, near-white points (never hidden),
// matching the toggle switches in the original chemical-universe.html prototype.
function syncGalaxyDimming() {
  for (const galaxy of state.galaxies) {
    const dimmed = !state.visibleFamilies.has(galaxy.name);
    galaxy.points.material.uniforms.uDim.value = dimmed ? 1 : 0;
    galaxy.haze.material.uniforms.uDim.value = dimmed ? 1 : 0;
  }
}

function bindEvents() {
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
  renderer.domElement.addEventListener("click", onCanvasClick);
  searchInput.addEventListener("input", updateSuggestions);
  searchInput.addEventListener("keydown", onSearchKeydown);
  toggleAllButton.addEventListener("click", toggleAllGalaxies);
  resetButton.addEventListener("click", resetView);
  document.addEventListener("keydown", onDocumentKeydown);
}

function onDocumentKeydown(event) {
  if (event.key === "Escape") deselectMolecule();
}

function onPointerDown(event) {
  renderer.domElement.setPointerCapture(event.pointerId);
  state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.activePointers.size >= 2) {
    state.dragging = false;
    state.pinchDistance = activePointerDistance();
    return;
  }
  state.dragging = true;
  state.lastPointer = { x: event.clientX, y: event.clientY };
}

function onPointerMove(event) {
  if (!state.activePointers.has(event.pointerId)) return;
  state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.activePointers.size >= 2) {
    const nextDistance = activePointerDistance();
    state.cameraRadius = zoomRadiusFromPinch(state.cameraRadius, state.pinchDistance, nextDistance);
    state.pinchDistance = nextDistance;
    state.suppressClickUntil = performance.now() + 300;
    state.fly = null;
    return;
  }
  if (!state.dragging) return;
  const dx = event.clientX - state.lastPointer.x;
  const dy = event.clientY - state.lastPointer.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) state.suppressClickUntil = performance.now() + 300;
  state.yaw -= dx * 0.004;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - dy * 0.004));
  state.lastPointer = { x: event.clientX, y: event.clientY };
  state.fly = null;
}

function onPointerUp(event) {
  state.activePointers.delete(event.pointerId);
  state.pinchDistance = 0;
  const remaining = state.activePointers.values().next().value;
  state.dragging = Boolean(remaining);
  if (remaining) state.lastPointer = remaining;
}

function onWheel(event) {
  state.cameraRadius = clampCameraRadius(state.cameraRadius + event.deltaY * 0.18);
  state.fly = null;
}

function onCanvasClick(event) {
  if (performance.now() < state.suppressClickUntil) return;
  const rect = renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const hit = pickStar(state.pointer, event.clientX - rect.left, event.clientY - rect.top, rect);
  if (!hit) return;
  const molecule = hit.object.userData.molecules[hit.index];
  selectMolecule({ ...molecule, galaxyId: hit.object.userData.galaxyId, localIndex: hit.index });
}

// A star's on-screen size has no simple relation to camera distance in this
// scene (the focused molecule can sit on a galaxy's rim, with the stars you
// actually see hundreds of units farther out). So cast with a generous
// world-space radius to gather every plausible candidate, then pick the star
// whose projected position lands closest to the cursor in *pixels* -- what the
// eye judges by -- and ignore matches too far from the click to count as aimed.
function pickStar(ndc, clickX, clickY, rect) {
  raycaster.params.Points.threshold = Math.min(40, Math.max(6, state.cameraRadius * 0.06));
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(state.galaxies.map((galaxy) => galaxy.points));
  if (!hits.length) return null;
  const world = new THREE.Vector3();
  let best = null;
  let bestPixels = Infinity;
  for (const candidate of hits) {
    const attr = candidate.object.geometry.attributes.position;
    world.fromBufferAttribute(attr, candidate.index).applyMatrix4(candidate.object.matrixWorld).project(camera);
    const sx = (world.x * 0.5 + 0.5) * rect.width;
    const sy = (-world.y * 0.5 + 0.5) * rect.height;
    const pixels = Math.hypot(sx - clickX, sy - clickY);
    if (pixels < bestPixels) {
      bestPixels = pixels;
      best = candidate;
    }
  }
  // Guard against selecting a distant star when the click landed on empty space.
  return bestPixels <= 30 ? best : null;
}

function onSearchKeydown(event) {
  if (event.key !== "Enter") return;
  const first = findSearchMatches(searchInput.value)[0];
  if (first) {
    const molecule = state.molecules.find((candidate) => candidate.id === first.id);
    selectMolecule(molecule);
    suggestions.classList.remove("open");
  }
}

function updateSuggestions() {
  const matches = findSearchMatches(searchInput.value).slice(0, 7);
  suggestions.innerHTML = "";
  suggestions.classList.toggle("open", matches.length > 0);
  for (const match of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${match.name}</span><small>${match.galaxy} · ${labelRecordType(match.recordType)}</small>`;
    button.addEventListener("click", () => {
      selectMolecule(state.molecules.find((molecule) => molecule.id === match.id));
      suggestions.classList.remove("open");
      searchInput.value = match.name;
    });
    suggestions.append(button);
  }
}

function findSearchMatches(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return state.searchIndex
    .filter((entry) => entry.name.toLowerCase().includes(normalized))
    .sort((a, b) => {
      if (a.recordType !== b.recordType) return a.recordType === "reference" ? -1 : 1;
      return a.name.length - b.name.length;
    });
}

function selectMolecule(molecule, options = {}) {
  if (!molecule) return;
  const { instant = false, moveCamera = true } = options;
  state.selected = molecule;

  const toTarget = new THREE.Vector3(molecule.position.x, molecule.position.y, molecule.position.z);
  const toRadius = 15;
  if (moveCamera) {
    if (instant) {
      state.target.copy(toTarget);
      state.cameraRadius = toRadius;
      state.fly = null;
    } else {
      state.fly = { t: 0, from: state.target.clone(), fromRadius: state.cameraRadius, toTarget, toRadius };
    }
  }

  selectionRing.position.copy(toTarget);
  selectionCore.position.copy(toTarget);
  const galaxyColor = state.galaxies.find((galaxy) => galaxy.name === molecule.galaxy)?.color;
  if (galaxyColor) selectionRing.material.color.set(galaxyColor);
  state.ringPulse = 0;
  state.markerVisible = true;

  if (!state.visibleFamilies.has(molecule.galaxy)) {
    state.visibleFamilies.add(molecule.galaxy);
    syncGalaxyDimming();
    const item = state.legendItems.get(molecule.galaxy);
    item?.classList.remove("off");
    item?.querySelector(".legend-toggle")?.setAttribute("aria-checked", "true");
  }

  locus.innerHTML = focusLabel(molecule);

  document.querySelector("#card-id").textContent = molecule.id;
  document.querySelector("#card-name").textContent = molecule.name;
  document.querySelector("#card-family").textContent = molecule.galaxy;
  document.querySelector("#card-mw").textContent = molecule.molecularWeight ? molecule.molecularWeight.toFixed(2) : "-";
  document.querySelector("#card-hbd").textContent = molecule.hbd ?? "-";
  document.querySelector("#card-fact").textContent = molecule.fact;
  renderMoleculeBadges(molecule);

  const factSource = document.querySelector("#card-fact-source");
  const reference = factReference(molecule);
  if (reference) {
    factSource.href = reference.href;
    factSource.textContent = reference.label;
    factSource.title = reference.title;
    factSource.classList.remove("hidden");
  } else {
    factSource.removeAttribute("href");
    factSource.removeAttribute("title");
    factSource.classList.add("hidden");
  }

  const source = document.querySelector("#card-source");
  if (molecule.sourceUrl) {
    source.href = molecule.sourceUrl;
    source.textContent = molecule.sourceId || "Source";
    source.classList.remove("hidden");
  } else {
    source.href = "#";
    source.textContent = "Demo density point";
    source.classList.remove("hidden");
  }

  renderStructure(molecule.smiles, molecule.recordType);
}

// Entering the star system now takes a deliberate zoom-in, so surface that
// affordance next to the focused galaxy name while a molecule is selected.
function focusLabel(molecule) {
  return `focus: <b>${molecule.galaxy}</b> · zoom in for star system`;
}

// Clears the current selection without moving the camera -- bound to Esc so
// the user can cancel the lock on a molecule and orbit freely again.
function deselectMolecule() {
  if (!state.selected) return;
  state.selected = null;
  state.markerVisible = false;
  locus.innerHTML = "focus: <b>intergalactic view</b>";

  document.querySelector("#card-id").textContent = "Select a molecule";
  document.querySelector("#card-name").textContent = "Molecular Galaxy Atlas";
  document.querySelector("#card-family").textContent = "Phase 1 scaffold";
  document.querySelector("#card-mw").textContent = "-";
  document.querySelector("#card-hbd").textContent = "-";
  document.querySelector("#card-fact").textContent =
    "Thousands of real, source-tracked molecules form ten chemical galaxies, revealing the diversity of chemical space.";
  document.querySelector("#card-badges").replaceChildren();

  const factSource = document.querySelector("#card-fact-source");
  factSource.removeAttribute("href");
  factSource.removeAttribute("title");
  factSource.classList.add("hidden");

  const source = document.querySelector("#card-source");
  source.href = "#";
  source.textContent = "Source";

  const svg = document.querySelector("#structure-svg");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  document.querySelector("#structure-tag").textContent = "2D structure";
}

// Deselects and flies the camera back to the wide intergalactic view the app
// opens on -- bound to the "reset" button.
function resetView() {
  deselectMolecule();
  state.fly = {
    t: 0,
    from: state.target.clone(),
    fromRadius: state.cameraRadius,
    toTarget: new THREE.Vector3(0, 0, 0),
    toRadius: 480
  };
}

function renderStructure(smiles, recordType) {
  const svg = document.querySelector("#structure-svg");
  const tag = document.querySelector("#structure-tag");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!smiles) {
    tag.textContent = recordType === "generated_demo" ? "demo exemplar structure" : "2D structure unavailable";
    return;
  }
  try {
    const drawer = new SmilesDrawer.SvgDrawer({
      width: 300,
      height: 190,
      padding: 16,
      themes: { light: { C: "#222", O: "#d9433f", N: "#327fd4", BACKGROUND: "#f3f2ea" } }
    });
    SmilesDrawer.parse(
      smiles,
      (tree) => {
        try {
          drawer.draw(tree, "structure-svg", "light", false);
          tag.textContent = recordType === "generated_demo" ? "demo exemplar structure" : "2D structure · live";
        } catch {
          tag.textContent = "2D structure render failed";
        }
      },
      () => {
        tag.textContent = "2D structure parse failed";
      }
    );
  } catch {
    tag.textContent = "2D structure error";
  }
}

function toggleAllGalaxies() {
  const hide = state.visibleFamilies.size > 0;
  state.visibleFamilies = hide ? new Set() : new Set(state.galaxies.map((galaxy) => galaxy.name));
  document.querySelectorAll(".legend-item").forEach((item) => {
    item.classList.toggle("off", hide);
    item.querySelector(".legend-toggle")?.setAttribute("aria-checked", String(!hide));
  });
  toggleAllButton.textContent = hide ? "show all" : "dim all";
  syncGalaxyDimming();
}

function labelRecordType(type) {
  return type === "generated_demo" ? "VISUAL DENSITY" : "REFERENCE";
}

function renderMoleculeBadges(molecule) {
  const container = document.querySelector("#card-badges");
  container.replaceChildren(
    ...moleculeBadges(molecule).map(({ label, tone }) => {
      const badge = document.createElement("span");
      badge.className = `badge ${tone === "pending" ? "muted" : ""}`.trim();
      badge.textContent = label;
      return badge;
    })
  );
}

function activePointerDistance() {
  const [first, second] = [...state.activePointers.values()];
  if (!first || !second) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function createStarField() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(1500 * 3);
  for (let index = 0; index < 1500; index += 1) {
    const radius = 520 + Math.random() * 420;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0x8796d8, size: 0.7, transparent: true, opacity: 0.45 })
  );
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  if (state.fly) {
    state.fly.t = Math.min(state.fly.t + dt / 1.15, 1);
    const eased = 1 - (1 - state.fly.t) ** 3;
    state.target.lerpVectors(state.fly.from, state.fly.toTarget, eased);
    state.cameraRadius = state.fly.fromRadius + (state.fly.toRadius - state.fly.fromRadius) * eased;
    if (state.fly.t >= 1) state.fly = null;
  } else if (!state.dragging) {
    state.yaw += 0.0072 * dt;
  }

  const x = state.target.x + Math.cos(state.yaw) * Math.cos(state.pitch) * state.cameraRadius;
  const y = state.target.y + Math.sin(state.pitch) * state.cameraRadius;
  const z = state.target.z + Math.sin(state.yaw) * Math.cos(state.pitch) * state.cameraRadius;
  camera.position.lerp(new THREE.Vector3(x, y, z), 0.08);
  camera.lookAt(state.target);
  state.elapsed += dt;
  updateGalaxyReveal();
  updateSolarSystem(dt);
  updateSelectionMarker(dt);
  renderer.render(scene, camera);
}

// Lifecycle is declarative: whichever way the camera got close to (or away
// from) the selected molecule -- fly-to finishing, manual zoom, Esc, reset --
// the system builds or dismantles from the same distance check each frame.
function updateSolarSystem(dt) {
  const shouldShow = Boolean(state.selected) && !state.fly && state.cameraRadius <= SYSTEM_ENTER_RADIUS;
  if (shouldShow && (!state.system || state.system.moleculeId !== state.selected.id)) {
    teardownSolarSystem();
    buildSolarSystem(state.selected);
  } else if (!shouldShow && state.system) {
    teardownSolarSystem();
    if (state.selected) locus.innerHTML = focusLabel(state.selected);
  }

  if (!state.system) return;
  state.systemTime += dt;
  for (const planet of state.system.planets) {
    const angle = planet.phase + state.systemTime * planet.speed;
    planet.mesh.position
      .set(Math.cos(angle) * planet.orbitRadius, 0, Math.sin(angle) * planet.orbitRadius)
      .applyQuaternion(planet.orbitQuat);
  }
}

function buildSolarSystem(molecule) {
  const galaxy = state.galaxies.find((candidate) => candidate.name === molecule.galaxy);
  const sunColor = new THREE.Color(galaxy?.color ?? "#7fd3ff");
  // Same cube-root-of-MW curve used for the galaxy star field, so a sun's
  // size matches how big its molecule renders as a star out in the field.
  const sunScale = sizeForMolecularWeight(molecule.molecularWeight, 1);

  // Solid, self-lit sphere reads as a real star; a point light at its core
  // gives the orbiting planets a day/night terminator. Two additive glow
  // sprites layered behind it (tight bright inner, soft wide outer) give it
  // a living corona without turning it back into a flat glow blob.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 32, 32),
    new THREE.MeshStandardMaterial({
      color: sunColor,
      emissive: sunColor,
      emissiveIntensity: 0.9,
      roughness: 0.55,
      metalness: 0
    })
  );
  sun.scale.setScalar(sunScale);
  systemGroup.add(sun);

  const coronaInner = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: sunColor,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  coronaInner.scale.setScalar(5.5 * sunScale);
  systemGroup.add(coronaInner);

  const coronaOuter = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: sunColor,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  coronaOuter.scale.setScalar(10 * sunScale);
  systemGroup.add(coronaOuter);

  const sunLight = new THREE.PointLight(sunColor, 2.6, 40 * sunScale, 1.4);
  systemGroup.add(sunLight);
  systemGroup.add(new THREE.AmbientLight(0xffffff, 0.25));

  const planetColor = sunColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
  const planetCount = Math.min(molecule.hbd ?? 0, MAX_PLANETS);
  const planets = [];
  // Push the innermost orbit out past the sun's surface so bigger suns don't
  // swallow their nearest planets.
  const orbitStart = Math.max(2.4, 1.6 * sunScale + 0.8);
  for (let index = 0; index < planetCount; index += 1) {
    const orbitRadius = orbitStart + index * 0.85;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 20),
      new THREE.MeshStandardMaterial({ color: planetColor, roughness: 0.85, metalness: 0.1 })
    );
    // Each planet gets its own randomly tilted orbital plane instead of all
    // sharing the system's base plane, so the system doesn't read as flat.
    const orbitQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((Math.random() - 0.5) * 1.1, Math.random() * Math.PI * 2, 0)
    );
    const ring = createOrbitRing(orbitRadius);
    ring.quaternion.copy(orbitQuat);
    systemGroup.add(mesh, ring);
    // Golden-angle phase spacing spreads planets around the sun; slower
    // outer orbits echo real orbital mechanics.
    planets.push({ mesh, orbitRadius, speed: 0.9 / Math.sqrt(orbitRadius), phase: index * 2.39996, orbitQuat });
  }

  systemGroup.position.set(molecule.position.x, molecule.position.y, molecule.position.z);
  systemGroup.rotation.set(0.45, 0, 0.2);
  state.system = { planets, moleculeId: molecule.id };
  state.systemTime = 0;
  setSystemFade(SYSTEM_BACKGROUND_FADE);

  const hbd = molecule.hbd ?? 0;
  locus.innerHTML = `system: <b>${molecule.name}</b> · ${hbd} H-donor${hbd === 1 ? "" : "s"}`;
}

function teardownSolarSystem() {
  for (const child of [...systemGroup.children]) {
    // Sprites share one static geometry across all instances -- never dispose it.
    if (!child.isSprite) child.geometry?.dispose();
    child.material?.dispose();
    systemGroup.remove(child);
  }
  state.system = null;
  setSystemFade(1);
}

function createOrbitRing(radius) {
  const segments = 64;
  const positions = new Float32Array(segments * 3);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 0;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.LineLoop(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false })
  );
}

function setSystemFade(value) {
  for (const galaxy of state.galaxies) {
    galaxy.points.material.uniforms.uSystemFade.value = value;
    galaxy.haze.material.uniforms.uSystemFade.value = value;
  }
}

function updateSelectionMarker(dt) {
  if (!state.markerVisible || state.system) {
    selectionRing.material.opacity = 0;
    selectionCore.material.opacity = 0;
    return;
  }
  state.ringPulse += dt;
  const cyclePos = (state.ringPulse % MARKER_PULSE_PERIOD) / MARKER_PULSE_PERIOD;
  const envelope = Math.sin(cyclePos * Math.PI);
  selectionRing.material.opacity = envelope * MARKER_MAX_OPACITY;
  selectionCore.material.opacity = envelope * MARKER_MAX_OPACITY * 0.9;
  selectionRing.scale.setScalar(1 + cyclePos * 1.4);
  selectionRing.quaternion.copy(camera.quaternion);
}

function updateGalaxyReveal() {
  for (const galaxy of state.galaxies) {
    const dx = camera.position.x - galaxy.center.x;
    const dy = camera.position.y - galaxy.center.y;
    const dz = camera.position.z - galaxy.center.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const reveal = smoothstep(REVEAL_START, REVEAL_FULL, distance);
    galaxy.points.material.uniforms.uReveal.value = reveal;
    galaxy.points.material.uniforms.uTime.value = state.elapsed;
    galaxy.haze.material.uniforms.uReveal.value = reveal;
  }
}

function smoothstep(edgeFar, edgeNear, value) {
  const t = Math.max(0, Math.min(1, (edgeFar - value) / (edgeFar - edgeNear)));
  return t * t * (3 - 2 * t);
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${__MGA_DATASET_VERSION__}`);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}
