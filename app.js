/**
 * IADA Park — Motor Three.JS de Renderizado 3D, Algoritmo de Tráfico Multinivel & UX Móvil Optimizada
 *
 * Mejoras implementadas:
 * 1. CORRECCIÓN DE RAMPAS Y FLUJO EN NIVEL 1 Y NIVEL 2:
 *    - Alineación geométrica exacta entre la pendiente física de las rampas centrales (Z = 11.0 pie de rampa
 *      en nivel inferior -> Z = 1.0 cima de rampa en nivel superior) y las trayectorias de subida y bajada.
 *    - Subida por el carril derecho (flecha verde, X = +1.15, de Z = 11.0 a Z = 1.0) y bajada por el carril
 *      izquierdo (flecha naranja, X = -1.15, de Z = 1.0 a Z = 11.0) tanto en PB <-> Nivel 1 como en Nivel 1 <-> Nivel 2.
 *    - Simulación activa simultánea en las 3 plantas (PB, Nivel 1 y Nivel 2) con visibilidad completa de los
 *      vehículos en tránsito para observar ascensos y descensos hacia/desde el Nivel 2 en todo momento.
 *
 * 2. OPTIMIZACIÓN DE INTERFAZ MÓVIL (BAJA CARGA COGNITIVA):
 *    - Jerarquía espacial limpia: barra superior unificada (Zona + Selector rápido PB/N1/N2 + Ticker en vivo),
 *      acceso directo a "Mi Cajón #B-14" en el header, y Bottom Sheet colapsado por defecto (44px) con resumen.
 *    - Navegación inferior de 4 pestañas claras: Mapa 3D, Zonas, Tráfico (Parámetros) y Mi Cajón.
 *
 * 3. ALGORITMO DE SIMULACIÓN PARAMETRIZABLE:
 *    - Controles interactivos de Nivel de Tráfico (Bajo, Normal, Alto, Hora Pico), Tiempo de Entrada (2.5s - 12s),
 *      Tiempo de Salida (2.5s - 12s), Tendencia de Flujo (Entrada, Equilibrado, Salida) y generador manual por nivel.
 */

const AppState = {
  theme: 'light',
  mode: 'web',
  selectedLot: 1,
  selectedLevel: 'P1',
  selectedBay: '',
  selectedBayLot: 1,
  selectedBayLevel: 'P1',
  bayLocked: true,
  isDocente: false,
  cameraMode: 'iso',
  simulationRunning: true,
  simulationTimer: null,
  recentActivity: 'Simulación activa: flujo vehicular multinivel',
  mobileSheetState: 'collapsed',
  levelRoundRobinIdx: 0,
  location: {
    proximity: 'near', // 'near' | 'far'
    distanceMeters: 320,
    source: 'sim'
  },
  reservation: {
    active: false,
    status: 'idle', // 'idle' | 'reserved' | 'occupied' | 'expired'
    bayCode: '',
    lotId: 1,
    levelKey: 'P1',
    arrivalWindow: 'Inmediato',
    graceSeconds: 600,
    remainingSeconds: 0,
    toleranceIncreased: false,
    pendingSelection: null,
    expiredBlockedBays: new Set(),
    intervalId: null
  }
};

const SimConfig = {
  trafficLevel: 'normal', // 'low' | 'normal' | 'high' | 'peak'
  spawnIntervalMs: 3200,
  maxConcurrentCars: 3,
  entryDurationSec: 5.5,
  exitDurationSec: 5.5,
  flowBias: 'balanced',   // 'entry' | 'balanced' | 'exit'
  entryProbability: 0.5
};

const TRAFFIC_PRESETS = {
  low:    { interval: 5200, maxCars: 1, label: 'Bajo (Máx. 1 auto)' },
  normal: { interval: 3200, maxCars: 3, label: 'Normal (Máx. 3 autos)' },
  high:   { interval: 1900, maxCars: 5, label: 'Alto (Máx. 5 autos)' },
  peak:   { interval: 1100, maxCars: 7, label: 'Hora Pico (Máx. 7 autos)' }
};

const REALISTIC_CAR_COLORS = [
  0x1e293b, 0x334155, 0x475569, 0x64748b,
  0x0f172a, 0x1d4ed8, 0x0369a1, 0x047857,
  0xb45309, 0x991b1b, 0x3f3f46, 0x52525b
];

function generateFloorInventoryDiagram(prefix, levelId, customCount) {
  const bays = {};
  const totalCount = customCount || (levelId === 'PB' ? 74 : 42);
  const occupancyRate = levelId === 'PB' ? 0.56 : (levelId === 'P1' ? 0.48 : 0.42);

  for (let i = 1; i <= totalCount; i++) {
    const code = `${prefix}${i.toString().padStart(2, '0')}`;
    const isOpenAirPB = (levelId === 'PB' && i > 42);
    const isTaken = (Math.random() < occupancyRate);
    const carColor = REALISTIC_CAR_COLORS[Math.floor(Math.random() * REALISTIC_CAR_COLORS.length)];

    bays[code] = {
      code,
      levelId,
      occupied: isTaken,
      isUserBay: false,
      isOpenAirPB,
      plateId: `CAR-${code}`,
      carColor,
      isAnimating: false
    };
  }
  return bays;
}

const ParkingInventory = {
  1: {
    'PB': generateFloorInventoryDiagram('PB-', 'PB', 74),
    'P1': generateFloorInventoryDiagram('B-', 'P1', 42),
    'P2': generateFloorInventoryDiagram('T-', 'P2', 42)
  },
  2: {
    'S': generateFloorInventoryDiagram('LC-', 'S', 24)
  },
  3: {
    'S': generateFloorInventoryDiagram('INT-', 'S', 32)
  }
};

const LotsMetadata = {
  1: {
    name: "1. Estacionamiento Central",
    shortName: "Central",
    type: "Oficial • 3 Plantas + Explanada PB",
    bayPrefix: "B-",
    totalCapacity: 158,
    hasLevels: true
  },
  2: {
    name: "2. Lienzo Charro",
    shortName: "Lienzo Charro",
    type: "Convenio Externo",
    bayPrefix: "LC-",
    totalCapacity: 24,
    hasLevels: false
  },
  3: {
    name: "3. Interior Campus",
    shortName: "Interior",
    type: "Personal & Desahogo",
    bayPrefix: "INT-",
    totalCapacity: 32,
    hasLevels: false
  }
};

const LOT_LAYOUT = {
  1: { x: 13, y: 0, z: 8, rotY: Math.PI / 2, focusRadius: 38 },
  2: { x: -25.5, y: 0, z: 1.5, rotY: -Math.PI / 2, focusRadius: 30 },
  3: { x: -29, y: 0, z: -41, rotY: -Math.PI / 2, focusRadius: 32 }
};

let scene, camera, renderer;
let containerElement;
let parkingGroup = null;
let lotGroups = {};
let centralFloorVisuals = {};
let navigationPathLine = null;
let carIndicatorMesh = null;
let bayMeshesMap = {};
let activeCarAnimations = [];
let raycaster = null;
let mouseCoords = null;
let clock = null;
let SharedAssets = null;

let mainDirLight = null;
let ambientHemiLight = null;
let cameraLookTarget = new THREE.Vector3(0, 1.5, -14);

// Pre-allocated scratch vectors for zero-GC render loop
const _evalPos = new THREE.Vector3();
const _evalTan = new THREE.Vector3();
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();
let cameraLerpActive = false;

function getPBRColors() {
  const isDark = AppState.theme === 'dark';
  return {
    bg: isDark ? 0x0a0e17 : 0xeaf0f6,
    floor: isDark ? 0x161e2c : 0xf1f5f9,
    floorPBOpen: isDark ? 0x182232 : 0xe2e8f0,
    floorInactive: isDark ? 0x111622 : 0xd5dee8,
    floorBorder: isDark ? 0x283548 : 0x94a3b8,
    floorBorderActive: isDark ? 0x3b82f6 : 0x163a70,
    column: isDark ? 0x1e2738 : 0x94a3b8,
    columnBase: isDark ? 0x2d3a52 : 0x64748b,
    accent: isDark ? 0x3b82f6 : 0x163a70,
    bayAvailable: 0x059669,
    bayTaken: isDark ? 0x242e3e : 0x64748b,
    bayLine: isDark ? 0x334155 : 0x64748b,
    roadAsphalt: isDark ? 0x101520 : 0x475569,
    roadMarking: isDark ? 0x3b4a62 : 0x94a3b8,
    navPath: isDark ? 0x60a5fa : 0x163a70,
    stairCore: isDark ? 0x1e283b : 0x64748b,
    stairGlass: isDark ? 0x1a2334 : 0x93c5fd,
    stairRailing: isDark ? 0x475569 : 0x475569,
    glassWindshield: isDark ? 0x0f172a : 0x1e293b,
    carOccupied: isDark ? 0x334155 : 0x475569,
    carTire: 0x0f172a,
    carWheelRim: 0xcbd5e1,
    carHeadlight: 0xffffff,
    carTaillight: 0xb91c1c,
    carBlinker: 0xf59e0b,
    fence: isDark ? 0x334155 : 0x64748b,
    groundPlane: isDark ? 0x080c14 : 0xdce4ee,
    campusGreen: isDark ? 0x0d1f18 : 0x9ec9ad,
    planterCurb: isDark ? 0x263244 : 0xe2e8f0,
    treeTrunk: isDark ? 0x3d2e22 : 0x6b5a4b,
    treeFoliage: isDark ? 0x15402b : 0x2f6b4a,
    treeFoliageLight: isDark ? 0x1c5238 : 0x438761,
    rampUpArrow: 0x10b981,
    rampDownArrow: 0xf97316
  };
}

function disposeSharedAssets() {
  if (!SharedAssets) return;
  SharedAssets.geometries.forEach(g => g.dispose());
  SharedAssets.materials.forEach(m => m.dispose());
  SharedAssets.textures.forEach(t => t.dispose());
  SharedAssets = null;
}

function initSharedAssets(colors) {
  disposeSharedAssets();
  const geometries = [];
  const materials = [];
  const textures = [];
  const trackGeo = (g) => { geometries.push(g); return g; };
  const trackMat = (m) => { materials.push(m); return m; };
  const trackTex = (t) => { textures.push(t); return t; };

  // Bay geometries (dimensiones corregidas para holgura lateral y longitudinal real)
  const bayGeoCentral = trackGeo(new THREE.PlaneGeometry(3.45, 1.66));
  const bayGeoFlat = trackGeo(new THREE.PlaneGeometry(3.55, 1.66));
  const bayBorderGeoCentral = trackGeo(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.45, 1.66)));
  const bayBorderGeoFlat = trackGeo(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.55, 1.66)));
  const stopperGeoCentral = trackGeo(new THREE.BoxGeometry(0.11, 0.07, 1.66 * 0.58));

  // Bay materials (shared across all 232+ bays)
  const bayMatSelected = trackMat(new THREE.MeshStandardMaterial({
    color: colors.accent, roughness: 0.58, metalness: 0.08, transparent: true, opacity: 0.96
  }));
  const bayMatAvailActive = trackMat(new THREE.MeshStandardMaterial({
    color: colors.bayAvailable, roughness: 0.58, metalness: 0.08, transparent: true, opacity: 0.84
  }));
  const bayMatTakenActive = trackMat(new THREE.MeshStandardMaterial({
    color: colors.bayTaken, roughness: 0.58, metalness: 0.08, transparent: true, opacity: 0.56
  }));
  const bayMatAvailInactive = trackMat(new THREE.MeshStandardMaterial({
    color: colors.bayAvailable, roughness: 0.58, metalness: 0.08, transparent: true, opacity: 0.34
  }));
  const bayMatTakenInactive = trackMat(new THREE.MeshStandardMaterial({
    color: colors.bayTaken, roughness: 0.58, metalness: 0.08, transparent: true, opacity: 0.34
  }));

  const bayBorderMatSelected = trackMat(new THREE.LineBasicMaterial({ color: colors.accent }));
  const bayBorderMatDefault = trackMat(new THREE.LineBasicMaterial({ color: colors.bayLine }));
  const stopperMatSelected = trackMat(new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.7 }));
  const stopperMatDefault = trackMat(new THREE.MeshStandardMaterial({ color: colors.roadMarking, roughness: 0.7 }));

  // Car geometries (optimizadas y proporcionadas al ancho de cajón de 1.66m)
  const tireGeo = trackGeo(new THREE.CylinderGeometry(0.23, 0.23, 0.19, 10));
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = trackGeo(new THREE.CylinderGeometry(0.135, 0.135, 0.20, 6));
  rimGeo.rotateZ(Math.PI / 2);

  const carGeos = {
    base: trackGeo(new THREE.BoxGeometry(1.26, 0.42, 2.74)),
    bumper: trackGeo(new THREE.BoxGeometry(1.30, 0.14, 2.84)),
    grille: trackGeo(new THREE.BoxGeometry(0.58, 0.13, 0.05)),
    cab: trackGeo(new THREE.BoxGeometry(1.06, 0.40, 1.46)),
    roof: trackGeo(new THREE.BoxGeometry(0.98, 0.06, 1.14)),
    mirror: trackGeo(new THREE.BoxGeometry(0.14, 0.08, 0.11)),
    light: trackGeo(new THREE.BoxGeometry(0.22, 0.09, 0.06)),
    tail: trackGeo(new THREE.BoxGeometry(0.24, 0.09, 0.06)),
    rev: trackGeo(new THREE.BoxGeometry(0.11, 0.055, 0.065)),
    blink: trackGeo(new THREE.BoxGeometry(0.08, 0.075, 0.065)),
    tire: tireGeo,
    rim: rimGeo,
    spoke: trackGeo(new THREE.BoxGeometry(0.21, 0.035, 0.22))
  };

  const carPaintMats = {};
  const getCarPaintMat = (hex) => {
    if (!carPaintMats[hex]) {
      carPaintMats[hex] = trackMat(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.28, metalness: 0.45 }));
    }
    return carPaintMats[hex];
  };

  const carStaticMats = {
    bumper: trackMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.78, metalness: 0.12 })),
    grille: trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 })),
    cab: trackMat(new THREE.MeshStandardMaterial({ color: colors.glassWindshield, roughness: 0.1, metalness: 0.85 })),
    tire: trackMat(new THREE.MeshStandardMaterial({ color: colors.carTire, roughness: 0.88, metalness: 0.1 })),
    rim: trackMat(new THREE.MeshStandardMaterial({ color: colors.carWheelRim, roughness: 0.25, metalness: 0.82 })),
    headLight: trackMat(new THREE.MeshStandardMaterial({ color: colors.carHeadlight, roughness: 0.1, metalness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.08 })),
    brakeLight: trackMat(new THREE.MeshStandardMaterial({ color: colors.carTaillight, roughness: 0.2, metalness: 0.5, emissive: 0xef4444, emissiveIntensity: 0.08 })),
    reverseLight: trackMat(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.0 })),
    blink: trackMat(new THREE.MeshStandardMaterial({ color: colors.carBlinker, roughness: 0.2, emissive: 0xf59e0b, emissiveIntensity: 0.0 }))
  };

  // Tree geometries & materials
  const treeGeos = {
    trunk: trackGeo(new THREE.CylinderGeometry(0.16, 0.24, 1.65, 7)),
    f1: trackGeo(new THREE.ConeGeometry(1.15, 2.0, 7)),
    f2: trackGeo(new THREE.ConeGeometry(0.88, 1.6, 7)),
    f3: trackGeo(new THREE.ConeGeometry(0.55, 1.15, 7))
  };
  const treeMats = {
    trunk: trackMat(new THREE.MeshStandardMaterial({ color: colors.treeTrunk, roughness: 0.9 })),
    dark: trackMat(new THREE.MeshStandardMaterial({ color: colors.treeFoliage, roughness: 0.78 })),
    light: trackMat(new THREE.MeshStandardMaterial({ color: colors.treeFoliageLight, roughness: 0.75 }))
  };

  // Lamp geometries & materials
  const lampGeos = {
    pole: trackGeo(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 6)),
    head: trackGeo(new THREE.BoxGeometry(0.8, 0.1, 0.25)),
    bulb: trackGeo(new THREE.BoxGeometry(0.6, 0.04, 0.18))
  };
  const lampMats = {
    pole: trackMat(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.3 })),
    bulb: trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }))
  };

  SharedAssets = {
    geometries, materials, textures, trackGeo, trackMat, trackTex,
    bayGeoCentral, bayGeoFlat, bayBorderGeoCentral, bayBorderGeoFlat, stopperGeoCentral,
    bayMatSelected, bayMatAvailActive, bayMatTakenActive, bayMatAvailInactive, bayMatTakenInactive,
    bayBorderMatSelected, bayBorderMatDefault, stopperMatSelected, stopperMatDefault,
    carGeos, getCarPaintMat, carStaticMats,
    treeGeos, treeMats, lampGeos, lampMats,
    getBayMat(isSelected, isOccupied, isLevelActive) {
      if (isSelected) return bayMatSelected;
      if (isLevelActive) return isOccupied ? bayMatTakenActive : bayMatAvailActive;
      return isOccupied ? bayMatTakenInactive : bayMatAvailInactive;
    }
  };
  return SharedAssets;
}

/**
 * Inicialización de Three.js
 */
function initThreeJS() {
  containerElement = document.getElementById('threeCanvasContainer');
  if (!containerElement) return;

  const width = containerElement.clientWidth || 800;
  const height = containerElement.clientHeight || 600;

  clock = new THREE.Clock();
  scene = new THREE.Scene();
  const colors = getPBRColors();
  scene.background = new THREE.Color(colors.bg);
  scene.fog = new THREE.FogExp2(colors.bg, 0.0032);

  camera = new THREE.PerspectiveCamera(AppState.mode === 'mobile' ? 45 : 38, width / height, 0.5, 600);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputEncoding = THREE.sRGBEncoding;

  containerElement.innerHTML = '';
  containerElement.appendChild(renderer.domElement);

  ambientHemiLight = new THREE.HemisphereLight(0xffffff, 0x64748b, 0.92);
  scene.add(ambientHemiLight);

  mainDirLight = new THREE.DirectionalLight(0xffffff, 0.92);
  mainDirLight.position.set(55, 72, 36);
  mainDirLight.castShadow = true;
  mainDirLight.shadow.mapSize.width = 1024;
  mainDirLight.shadow.mapSize.height = 1024;
  mainDirLight.shadow.camera.near = 10;
  mainDirLight.shadow.camera.far = 170;
  mainDirLight.shadow.camera.left = -45;
  mainDirLight.shadow.camera.right = 45;
  mainDirLight.shadow.camera.top = 40;
  mainDirLight.shadow.camera.bottom = -40;
  mainDirLight.target.position.set(25, 0, 0);
  scene.add(mainDirLight.target);
  mainDirLight.shadow.bias = -0.0005;
  scene.add(mainDirLight);

  const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.36);
  fillLight.position.set(-45, 32, -40);
  scene.add(fillLight);

  raycaster = new THREE.Raycaster();
  mouseCoords = new THREE.Vector2();

  setupOrbitControls();
  setupRaycastSelection();
  setupMobileSheetTouch();
  setupMobileRadialMenuGesture();
  rebuildParking3D();
  syncAssignedBayUI();
  setCameraCampusOverview(true);

  window.addEventListener('resize', onWindowResize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => onWindowResize());
    ro.observe(containerElement);
  }
  renderLoop();

  restartSimulationLoop();
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (document.hidden) return;

  const dt = clock ? Math.min(clock.getDelta(), 0.05) : 0.016;
  const elapsed = clock ? clock.getElapsedTime() : 0;

  if (cameraLerpActive) {
    const alpha = Math.min(1, dt * 6.5);
    cameraLookTarget.lerp(_camGoalTarget, alpha);
    camera.position.lerp(_camGoalPos, alpha);
    camera.lookAt(cameraLookTarget);
    if (camera.position.distanceToSquared(_camGoalPos) < 0.04 &&
        cameraLookTarget.distanceToSquared(_camGoalTarget) < 0.02) {
      camera.position.copy(_camGoalPos);
      cameraLookTarget.copy(_camGoalTarget);
      camera.lookAt(cameraLookTarget);
      cameraLerpActive = false;
    }
  }

  updateMultilevelCarAnimations(dt, elapsed);
  updateAssignedPinAnimation(elapsed);
  renderer.render(scene, camera);
}

function updateAssignedPinAnimation(elapsed) {
  if (carIndicatorMesh && carIndicatorMesh.userData.pin) {
    carIndicatorMesh.userData.pin.position.y = 2.15 + Math.sin(elapsed * 3.2) * 0.14;
    carIndicatorMesh.userData.pin.rotation.y = elapsed * 1.5;
  }
}

function onWindowResize() {
  syncResponsiveMode(true);
  if (!containerElement || !renderer || !camera) return;
  const width = containerElement.clientWidth || 380;
  const height = containerElement.clientHeight || 500;
  camera.aspect = width / height;
  camera.fov = AppState.mode === 'mobile' ? 45 : 38;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function getActiveFloorHeight() {
  if (AppState.selectedLot !== 1) return 0.5;
  if (AppState.selectedLevel === 'PB') return 0.5;
  if (AppState.selectedLevel === 'P1') return 4.2;
  return 8.4;
}

function moveCameraTo(posX, posY, posZ, tgtX, tgtY, tgtZ, instant = false) {
  _camGoalPos.set(posX, posY, posZ);
  _camGoalTarget.set(tgtX, tgtY, tgtZ);
  if (instant) {
    cameraLerpActive = false;
    cameraLookTarget.copy(_camGoalTarget);
    camera.position.copy(_camGoalPos);
    camera.lookAt(cameraLookTarget);
  } else {
    cameraLerpActive = true;
  }
}

function syncCameraButtonsUI() {
  const modeMap = {
    overview: 'btnCamOverview',
    iso: 'btnCamIso',
    top: 'btnCamTop',
    bay: 'btnCamBay'
  };
  Object.entries(modeMap).forEach(([mode, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active', AppState.cameraMode === mode);
  });

  const activeMobileLot = (AppState.cameraMode === 'overview') ? 0 : AppState.selectedLot;
  const hubBtn = document.getElementById('radialHubCampus');
  if (hubBtn) hubBtn.classList.toggle('active', activeMobileLot === 0);
  [1, 2, 3].forEach(idx => {
    const btn = document.getElementById(`radialLotBtn${idx}`);
    if (btn) btn.classList.toggle('active', activeMobileLot === idx);
  });

  syncMobileQuickLevelButtons();
}

function setMobileRadialMenuOpen(isOpen) {
  const menu = document.getElementById('mobileRadialMenu');
  const backdrop = document.getElementById('radialMenuBackdrop');
  const handle = document.getElementById('radialEdgeHandle');
  if (!menu) return;

  const shouldOpen = Boolean(isOpen) && AppState.mode === 'mobile';
  menu.classList.toggle('open', shouldOpen);
  menu.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (backdrop) backdrop.classList.toggle('open', shouldOpen);
  if (handle) handle.classList.toggle('hidden', shouldOpen);
}

function openMobileRadialMenu() {
  setMobileRadialMenuOpen(true);
}

function closeMobileRadialMenu() {
  setMobileRadialMenuOpen(false);
}

function toggleMobileRadialMenu() {
  const menu = document.getElementById('mobileRadialMenu');
  if (!menu) return;
  setMobileRadialMenuOpen(!menu.classList.contains('open'));
}

function setupMobileRadialMenuGesture() {
  const stage = document.querySelector('.three-stage-wrapper');
  if (!stage) return;

  let swipeState = null;

  const beginSwipe = (clientX, clientY) => {
    if (AppState.mode !== 'mobile') return;
    const rect = stage.getBoundingClientRect();
    const relX = clientX - rect.left;
    const menu = document.getElementById('mobileRadialMenu');
    const isOpen = menu && menu.classList.contains('open');

    if (!isOpen && relX >= 0 && relX <= 42) {
      swipeState = { mode: 'open', startX: clientX, startY: clientY };
    } else if (isOpen) {
      swipeState = { mode: 'close', startX: clientX, startY: clientY };
    }
  };

  const moveSwipe = (clientX, clientY) => {
    if (!swipeState || AppState.mode !== 'mobile') return;
    const dx = clientX - swipeState.startX;
    const dy = Math.abs(clientY - swipeState.startY);

    if (swipeState.mode === 'open' && dx > 22 && dx > dy * 1.15) {
      isDragging = false;
      openMobileRadialMenu();
      swipeState = null;
    } else if (swipeState.mode === 'close' && dx < -28 && Math.abs(dx) > dy * 1.15) {
      isDragging = false;
      closeMobileRadialMenu();
      swipeState = null;
    }
  };

  const endSwipe = () => {
    swipeState = null;
  };

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      beginSwipe(e.touches[0].clientX, e.touches[0].clientY);
    } else {
      swipeState = null;
    }
  }, { passive: true, capture: true });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && swipeState) {
      moveSwipe(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true, capture: true });

  stage.addEventListener('touchend', endSwipe, { passive: true, capture: true });
  stage.addEventListener('touchcancel', endSwipe, { passive: true, capture: true });

  stage.addEventListener('mousedown', (e) => {
    if (e.button === 0) beginSwipe(e.clientX, e.clientY);
  }, { capture: true });

  window.addEventListener('mousemove', (e) => {
    if (swipeState) moveSwipe(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', endSwipe);
}

function selectMobileLotView(lotOrOverview) {
  if (AppState.mode === 'mobile') {
    setMobileSheetState('collapsed');
    closeSimConfigPanel();
    closeMobileCredential();
  }
  if (lotOrOverview === 0) {
    setCameraCampusOverview();
    const hudTitle = document.getElementById('hudLotTitle');
    if (hudTitle) hudTitle.innerText = 'Campus Completo (3 Zonas)';
  } else {
    selectLot(lotOrOverview);
  }
}

function setCameraCampusOverview(instant = false) {
  const isMobile = AppState.mode === 'mobile';
  moveCameraTo(
    isMobile ? 2 : 0,
    isMobile ? 96 : 74,
    isMobile ? 54 : 42,
    0, 0.5, -15,
    instant
  );
  AppState.cameraMode = 'overview';
  syncCameraButtonsUI();
}

function setCameraIsometric(instant = false) {
  const isMobile = AppState.mode === 'mobile';
  const layout = LOT_LAYOUT[AppState.selectedLot] || LOT_LAYOUT[1];
  const focusY = getActiveFloorHeight();
  const dist = AppState.selectedLot === 1 ? (isMobile ? 42 : 36) : (isMobile ? 32 : 27);
  const heightOffset = AppState.selectedLot === 1 ? (isMobile ? 33 : 27) : (isMobile ? 26 : 22);

  moveCameraTo(
    layout.x + dist * 0.9,
    focusY + heightOffset,
    layout.z + dist * 0.9,
    layout.x, focusY, layout.z,
    instant
  );
  AppState.cameraMode = 'iso';
  syncCameraButtonsUI();
}

function setCameraTop() {
  const isMobile = AppState.mode === 'mobile';
  const layout = LOT_LAYOUT[AppState.selectedLot] || LOT_LAYOUT[1];
  const focusY = getActiveFloorHeight();
  moveCameraTo(
    layout.x,
    focusY + (isMobile ? 64 : 52),
    layout.z + 0.01,
    layout.x, focusY, layout.z,
    false
  );
  AppState.cameraMode = 'top';
  syncCameraButtonsUI();
}

function getLevelDisplayLabel(lotId, levelKey) {
  if (lotId !== 1) return 'Superficie';
  if (levelKey === 'PB') return 'Planta Baja';
  if (levelKey === 'P2') return 'Nivel 2';
  return 'Nivel 1';
}

function syncAssignedBayUI() {
  const code = AppState.selectedBay;
  const lotId = AppState.selectedBayLot || 1;
  const levelKey = AppState.selectedBayLevel || (lotId === 1 ? 'P1' : 'S');
  const levelLabel = getLevelDisplayLabel(lotId, levelKey);
  const lotName = LotsMetadata[lotId] ? LotsMetadata[lotId].name : '1. Estacionamiento Central';

  const hasBay = Boolean(code);
  const pillCode = document.getElementById('mobileBayPillCode');
  if (pillCode) pillCode.innerText = hasBay ? `#${code}` : 'Sin asignar';

  const credBay = document.getElementById('mobileCredBay');
  if (credBay) credBay.innerText = hasBay ? `#${code} (${levelLabel})` : 'Ninguno (Selecciona un cajón libre)';

  const credZone = document.getElementById('mobileCredZone');
  if (credZone) credZone.innerText = hasBay ? lotName : 'Campus';

  const credGuide = document.getElementById('mobileCredGuideLabel');
  if (credGuide) credGuide.innerText = hasBay ? `Guiar a #${code}` : 'Ir al Mapa';

  const inspectTitle = document.getElementById('bayInspectTitle');
  if (inspectTitle) inspectTitle.innerText = hasBay ? `Cajón Agendado: #${code}` : 'Sin Cajón Agendado';

  const navLabel = document.getElementById('btnNavigateBayLabel');
  if (navLabel) navLabel.innerText = hasBay ? `Navegar a #${code}` : 'Ver Mapa';

  const btnCamBay = document.getElementById('btnCamBay');
  if (btnCamBay) btnCamBay.title = hasBay ? `Enfocar Mi Cajón #${code}` : 'Enfocar Mi Cajón';

  [1, 2, 3].forEach(id => {
    const mBtn = document.getElementById(`mAssignZone${id}`);
    const dBtn = document.getElementById(`dAssignZone${id}`);
    if (mBtn) mBtn.classList.toggle('active', id === lotId);
    if (dBtn) dBtn.classList.toggle('active', id === lotId);
  });
}

function getToleranceSecondsForLocation() {
  return (AppState.location && AppState.location.proximity === 'far') ? 300 : 600;
}

function setCampusLocationMode(mode, distMeters = null) {
  const isFar = (mode === 'far');
  AppState.location.proximity = isFar ? 'far' : 'near';
  AppState.location.distanceMeters = distMeters !== null ? distMeters : (isFar ? 2800 : 320);
  AppState.location.source = distMeters !== null ? 'gps' : 'sim';

  ['dLocNear', 'mLocNear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !isFar);
  });
  ['dLocFar', 'mLocFar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', isFar);
  });

  syncReservationUI();
  const distLabel = AppState.location.distanceMeters >= 1000
    ? `${(AppState.location.distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(AppState.location.distanceMeters)} m`;
  updateLiveFeedUI(
    isFar
      ? `Ubicación lejos del campus (${distLabel}): tolerancia estricta (05:00 min), sin aumento permitido.`
      : `Ubicación cerca del campus (${distLabel}): tolerancia de 10:00 min y aumento permitido.`
  );
}

function detectUserCampusLocation() {
  if (!navigator.geolocation) {
    showRestrictionAlert('', 'gps_unsupported');
    return;
  }
  updateLiveFeedUI('Detectando ubicación GPS respecto al campus...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Coordenadas de referencia del campus universitario (IADA / UACJ)
      const campusLat = 31.7426;
      const campusLng = -106.4326;
      const toRad = d => (d * Math.PI) / 180;
      const R = 6371000;
      const dLat = toRad(pos.coords.latitude - campusLat);
      const dLon = toRad(pos.coords.longitude - campusLng);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(campusLat)) * Math.cos(toRad(pos.coords.latitude)) * Math.sin(dLon / 2) ** 2;
      const dist = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      setCampusLocationMode(dist <= 1000 ? 'near' : 'far', Math.round(dist));
    },
    () => {
      showRestrictionAlert('', 'gps_denied');
    },
    { timeout: 6000 }
  );
}

function formatCountdown(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(sec / 60).toString().padStart(2, '0');
  const secs = (sec % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function getSelectedArrivalWindow() {
  const dSel = document.getElementById('dArrivalWindow');
  const mSel = document.getElementById('mArrivalWindow');
  return (dSel && dSel.value) || (mSel && mSel.value) || 'Inmediato';
}

function syncArrivalWindowSelects(val) {
  const dSel = document.getElementById('dArrivalWindow');
  const mSel = document.getElementById('mArrivalWindow');
  if (dSel) dSel.value = val;
  if (mSel) mSel.value = val;
  if (AppState.reservation) {
    AppState.reservation.arrivalWindow = val;
  }
}

function stopReservationTimer() {
  if (AppState.reservation && AppState.reservation.intervalId) {
    clearInterval(AppState.reservation.intervalId);
    AppState.reservation.intervalId = null;
  }
}

function startReservationTimer() {
  stopReservationTimer();
  const res = AppState.reservation;
  if (!res || res.status !== 'reserved') return;

  res.intervalId = setInterval(() => {
    if (res.status !== 'reserved') {
      stopReservationTimer();
      return;
    }
    res.remainingSeconds -= 1;
    if (res.remainingSeconds <= 0) {
      res.remainingSeconds = 0;
      cancelBayReservation(true);
    } else {
      syncReservationUI();
    }
  }, 1000);
}

function syncReservationUI() {
  const res = AppState.reservation;
  if (!res) return;

  const formatted = formatCountdown(res.remainingSeconds);
  const isWarning = (res.status === 'reserved' && res.remainingSeconds <= 120);
  const isSecured = (res.status === 'occupied');
  const isExpired = (res.status === 'expired');

  const dTimer = document.getElementById('dReservationTimer');
  const mTimer = document.getElementById('mReservationTimer');
  const pillTimer = document.getElementById('mobilePillTimer');

  [dTimer, mTimer].forEach(el => {
    if (!el) return;
    el.classList.remove('warning', 'secured', 'expired');
    if (isSecured) {
      el.innerText = 'OCUPADO';
      el.classList.add('secured');
    } else if (isExpired) {
      el.innerText = 'EXPIRADO';
      el.classList.add('expired');
    } else if (res.status === 'idle') {
      el.innerText = 'SIN RESERVA';
    } else {
      el.innerText = formatted;
      if (isWarning) el.classList.add('warning');
    }
  });

  if (pillTimer) {
    pillTimer.classList.remove('warning', 'secured');
    if (isSecured) {
      pillTimer.innerText = 'OK';
      pillTimer.classList.add('secured');
    } else if (res.status === 'reserved') {
      pillTimer.innerText = formatted;
      if (isWarning) pillTimer.classList.add('warning');
    } else {
      pillTimer.innerText = '--:--';
    }
  }

  const mStatus = document.getElementById('mReservationStatus');
  if (mStatus) {
    if (isSecured) {
      mStatus.innerText = `Cajón #${res.bayCode} ocupado y asegurado`;
    } else if (isExpired) {
      mStatus.innerText = 'Tiempo límite expirado • Agenda otro cajón';
    } else if (res.status === 'idle') {
      mStatus.innerText = 'Sin cajón agendado • Selecciona uno libre';
    } else {
      mStatus.innerText = `Agendado (${res.arrivalWindow}) • Tienes ${formatted} para llegar`;
    }
  }

  const dBadge = document.getElementById('bayInspectBadge');
  if (dBadge) {
    const span = dBadge.querySelector('span') || dBadge;
    if (isSecured) {
      span.innerText = 'Ocupado y Asegurado';
    } else if (res.status === 'reserved') {
      span.innerText = `Agendado (${res.arrivalWindow}) • ${formatted}`;
    } else {
      span.innerText = 'Sin Reserva Activa';
    }
  }

  const canConfirm = (res.status === 'reserved');
  const canCancel = (res.status === 'reserved' || res.status === 'occupied');
  const canBoost = (
    res.status === 'reserved' &&
    AppState.location.proximity === 'near' &&
    !res.toleranceIncreased
  );

  ['dBtnConfirmArrival', 'mBtnConfirmArrival'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canConfirm;
  });
  ['dBtnCancelRes', 'mBtnCancelRes'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canCancel;
  });
  ['dBtnBoostTolerance', 'mBtnBoostTolerance'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = (res.status !== 'reserved');
      btn.title = AppState.location.proximity === 'far'
        ? 'Ubicación lejos del campus: no se permite aumento de tolerancia'
        : (res.toleranceIncreased ? 'Aumento ya utilizado' : 'Aumentar +3:00 min de tolerancia');
      btn.style.opacity = canBoost ? '1' : '0.55';
    }
  });

  const dRule = document.getElementById('dRuleText');
  if (dRule) {
    if (res.status === 'expired') {
      dRule.innerHTML = '<strong>Tiempo expirado:</strong> Debes elegir otro cajón diferente (sin aumento de tolerancia).';
    } else if (AppState.location.proximity === 'far') {
      dRule.innerHTML = '<strong>Ubicación lejana:</strong> Tolerancia fija <strong>05:00 min</strong> (no se permite aumento).';
    } else {
      dRule.innerHTML = '<strong>Ubicación cercana:</strong> Tolerancia <strong>10:00 min</strong> (+3m permitido). Si expira, elige otro cajón.';
    }
  }
}

function requestBaySelection(code, lotId, levelKey, arrivalWindow = getSelectedArrivalWindow()) {
  const res = AppState.reservation;
  if (res.expiredBlockedBays && res.expiredBlockedBays.has(code)) {
    showRestrictionAlert(code, 'expired_blocked');
    return false;
  }

  const inv = ParkingInventory[lotId] && ParkingInventory[lotId][levelKey];
  if (!inv || !inv[code]) return false;

  if (code !== AppState.selectedBay && (inv[code].occupied || inv[code].isAnimating)) {
    showRestrictionAlert(code, 'occupied');
    return false;
  }

  res.pendingSelection = { code, lotId, levelKey, arrivalWindow };

  const modal = document.getElementById('bayConfirmModal');
  const qEl = document.getElementById('bayConfirmQuestion');
  const mEl = document.getElementById('bayConfirmMeta');
  const lotName = LotsMetadata[lotId] ? LotsMetadata[lotId].shortName : 'Campus';
  const lvlLabel = getLevelDisplayLabel(lotId, levelKey);
  const tolSec = getToleranceSecondsForLocation();
  const isNear = AppState.location.proximity === 'near';

  if (qEl) {
    qEl.textContent = '';
    qEl.appendChild(document.createTextNode('¿Confirmas tu elección del cajón '));
    const strong = document.createElement('strong');
    strong.textContent = `#${code}`;
    qEl.appendChild(strong);
    qEl.appendChild(document.createTextNode(` (${lotName} • ${lvlLabel})?`));
  }
  if (mEl) {
    mEl.innerText = isNear
      ? `Ubicación cerca del campus: se asignará una tolerancia de ${formatCountdown(tolSec)} min (aumento +3m permitido).`
      : `Ubicación demasiado lejos del campus: tiempo estricto de ${formatCountdown(tolSec)} min (sin aumento de tolerancia).`;
  }
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
  return true;
}

function confirmPendingBaySelection() {
  const pending = AppState.reservation.pendingSelection;
  const modal = document.getElementById('bayConfirmModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (!pending) return;
  AppState.reservation.pendingSelection = null;
  scheduleBay(pending.code, pending.lotId, pending.levelKey, pending.arrivalWindow);
}

function cancelPendingBaySelection() {
  AppState.reservation.pendingSelection = null;
  const modal = document.getElementById('bayConfirmModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function scheduleBay(code, lotId, levelKey, arrivalWindow = getSelectedArrivalWindow()) {
  const res = AppState.reservation;
  if (res.expiredBlockedBays && res.expiredBlockedBays.has(code)) {
    showRestrictionAlert(code, 'expired_blocked');
    return false;
  }

  const inv = ParkingInventory[lotId] && ParkingInventory[lotId][levelKey];
  if (!inv || !inv[code]) return false;

  if (code !== AppState.selectedBay && (inv[code].occupied || inv[code].isAnimating)) {
    showRestrictionAlert(code, 'occupied');
    return false;
  }

  // Liberar cajón apartado anterior si existía
  const prevInv = ParkingInventory[AppState.selectedBayLot] && ParkingInventory[AppState.selectedBayLot][AppState.selectedBayLevel];
  if (prevInv && prevInv[AppState.selectedBay]) {
    prevInv[AppState.selectedBay].occupied = false;
  }

  const tolSeconds = getToleranceSecondsForLocation();
  inv[code].occupied = true;
  AppState.selectedBay = code;
  AppState.selectedBayLot = lotId;
  AppState.selectedBayLevel = levelKey;

  res.active = true;
  res.status = 'reserved';
  res.bayCode = code;
  res.lotId = lotId;
  res.levelKey = levelKey;
  res.arrivalWindow = arrivalWindow;
  res.graceSeconds = tolSeconds;
  res.remainingSeconds = tolSeconds;
  res.toleranceIncreased = false;

  startReservationTimer();
  syncAssignedBayUI();
  syncReservationUI();
  rebuildParking3D();
  updateInventoryStatsUI();

  const lotName = LotsMetadata[lotId] ? LotsMetadata[lotId].shortName : 'Campus';
  updateLiveFeedUI(`Cajón #${code} confirmado en ${lotName}. Tolerancia asignada: ${formatCountdown(tolSeconds)} min.`);
  setCameraBay();
  return true;
}

function requestToleranceIncrease() {
  const res = AppState.reservation;
  if (res.status === 'expired') {
    showRestrictionAlert(res.bayCode, 'no_increase_expired');
    return;
  }
  if (res.status !== 'reserved') {
    showRestrictionAlert('', 'no_active_res');
    return;
  }
  if (AppState.location.proximity === 'far') {
    showRestrictionAlert(res.bayCode, 'far_no_tolerance');
    return;
  }
  if (res.toleranceIncreased) {
    showRestrictionAlert(res.bayCode, 'tolerance_already_used');
    return;
  }

  res.remainingSeconds += 180;
  res.toleranceIncreased = true;
  syncReservationUI();
  updateLiveFeedUI(`Tolerancia aumentada +3:00 min para #${res.bayCode} por ubicación cercana al campus.`);
}

function quickScheduleCurrentZone() {
  assignBayByZone(AppState.selectedLot || 1);
}

function confirmBayArrival() {
  const res = AppState.reservation;
  if (!res || res.status !== 'reserved') return;
  stopReservationTimer();
  res.status = 'occupied';
  syncReservationUI();
  updateLiveFeedUI(`Llegada confirmada: Cajón #${res.bayCode} ocupado y asegurado.`);
  showRestrictionAlert(res.bayCode, 'secured');
}

function cancelBayReservation(expired = false) {
  const res = AppState.reservation;
  if (!res) return;
  stopReservationTimer();

  const prevCode = AppState.selectedBay;
  const prevInv = ParkingInventory[AppState.selectedBayLot] && ParkingInventory[AppState.selectedBayLot][AppState.selectedBayLevel];
  if (prevInv && prevInv[prevCode]) {
    prevInv[prevCode].occupied = false;
  }

  if (expired && prevCode) {
    res.expiredBlockedBays.add(prevCode);
  }

  res.active = false;
  res.status = expired ? 'expired' : 'idle';
  res.remainingSeconds = 0;
  res.toleranceIncreased = false;
  AppState.selectedBay = '';

  syncAssignedBayUI();
  syncReservationUI();
  rebuildParking3D();
  updateInventoryStatsUI();

  if (expired) {
    updateLiveFeedUI(`Tiempo expirado en #${prevCode}: debes seleccionar otro cajón (no puedes repetir #${prevCode} ni aumentar tolerancia).`);
    showRestrictionAlert(prevCode, 'expired');
  } else if (prevCode) {
    updateLiveFeedUI(`Reserva de #${prevCode} liberada. Selecciona un cajón libre para agendar.`);
  } else {
    updateLiveFeedUI('Selecciona un cajón libre para agendar.');
  }
}

function assignBayByZone(lotId) {
  const targetLotId = [1, 2, 3].includes(lotId) ? lotId : 1;
  const candidateLevels = targetLotId === 1
    ? (AppState.selectedLot === 1
      ? [AppState.selectedLevel, 'P1', 'PB', 'P2'].filter((v, i, a) => a.indexOf(v) === i)
      : ['P1', 'PB', 'P2'])
    : ['S'];

  const blocked = AppState.reservation.expiredBlockedBays;
  let chosenLevel = null;
  let chosenCode = null;

  for (const lvl of candidateLevels) {
    const inv = ParkingInventory[targetLotId] && ParkingInventory[targetLotId][lvl];
    if (!inv) continue;
    const freeKey = Object.keys(inv).find(k => !inv[k].occupied && !inv[k].isAnimating && (!blocked || !blocked.has(k)));
    if (freeKey) {
      chosenLevel = lvl;
      chosenCode = freeKey;
      break;
    }
  }

  if (chosenCode && chosenLevel) {
    requestBaySelection(chosenCode, targetLotId, chosenLevel, getSelectedArrivalWindow());
  } else {
    showRestrictionAlert('', 'occupied');
  }
}

function setCameraBay() {
  if (!AppState.selectedBay) {
    if (AppState.mode === 'mobile') {
      const credCard = document.getElementById('mobileCredentialCard');
      if (credCard) credCard.classList.add('show');
    } else {
      setCameraIsometric();
    }
    showRestrictionAlert('', 'no_active_res');
    return;
  }

  const targetLot = AppState.selectedBayLot || 1;
  const targetLevel = AppState.selectedBayLevel || (targetLot === 1 ? 'P1' : 'S');

  if (AppState.selectedLot !== targetLot || (targetLot === 1 && AppState.selectedLevel !== targetLevel)) {
    AppState.selectedLot = targetLot;
    if (targetLot === 1) AppState.selectedLevel = targetLevel;

    for (let i = 1; i <= 3; i++) {
      const c = document.getElementById(`card-lot-${i}`);
      if (c) c.classList.toggle('active', i === targetLot);
    }

    if (targetLot === 1) {
      document.querySelectorAll('.level-tab').forEach(b => b.classList.remove('active'));
      const tabBtn = document.getElementById(`tab${targetLevel}`);
      if (tabBtn) tabBtn.classList.add('active');
      const lvlTxt = document.getElementById('selectedLevelText');
      if (lvlTxt) lvlTxt.innerText = getLevelDisplayLabel(1, targetLevel);
    }

    syncMobileQuickLevelButtons();
    const hudTitle = document.getElementById('hudLotTitle');
    if (hudTitle && LotsMetadata[targetLot]) hudTitle.innerText = LotsMetadata[targetLot].name;
    updateCentralLevelsVisualState();
    updateInventoryStatsUI();
  }

  if (AppState.mode === 'mobile') {
    setMobileSheetState('collapsed');
    closeSimConfigPanel();
    closeMobileCredential();
  }

  const isMobile = AppState.mode === 'mobile';
  const targetBay = bayMeshesMap[AppState.selectedBay];
  const bx = targetBay ? targetBay.worldX : (LOT_LAYOUT[targetLot].x - 3.9);
  const by = targetBay ? targetBay.y : (targetLot === 1 ? 4.4 : 0.25);
  const bz = targetBay ? targetBay.worldZ : (LOT_LAYOUT[targetLot].z - 8.25);

  moveCameraTo(
    bx + (isMobile ? 12.0 : 10.5),
    by + (isMobile ? 9.0 : 8.0),
    bz + (isMobile ? 12.0 : 10.5),
    bx, by + 0.5, bz,
    false
  );
  AppState.cameraMode = 'bay';
  syncCameraButtonsUI();
}

/**
 * Controles de Órbita y Multitouch optimizados
 */
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

function setupOrbitControls() {
  const dom = renderer.domElement;

  dom.addEventListener('mousedown', (e) => {
    cameraLerpActive = false;
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    handleOrbitRotate(e.clientX - previousMousePosition.x, e.clientY - previousMousePosition.y);
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  let touchStartDist = 0;

  dom.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isDragging = false;
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  dom.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isDragging) {
      handleOrbitRotate(
        e.touches[0].clientX - previousMousePosition.x,
        e.touches[0].clientY - previousMousePosition.y
      );
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isDragging = false;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const diff = touchStartDist - dist;
      if (Math.abs(diff) > 1.5) {
        zoomCameraByFactor(diff > 0 ? 1.035 : 0.965);
        touchStartDist = dist;
      }
    }
  }, { passive: true });

  dom.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      isDragging = false;
    }
  }, { passive: true });

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomCameraByFactor(e.deltaY > 0 ? 1.07 : 0.93);
  }, { passive: false });
}

function zoomCameraByFactor(scaleFactor) {
  cameraLerpActive = false;
  const offset = camera.position.clone().sub(cameraLookTarget);
  offset.multiplyScalar(scaleFactor);
  offset.clampLength(10, 140);
  camera.position.copy(cameraLookTarget).add(offset);
  camera.lookAt(cameraLookTarget);
}

function handleOrbitRotate(deltaX, deltaY) {
  cameraLerpActive = false;
  const center = cameraLookTarget;
  const offset = camera.position.clone().sub(center);
  const radius = offset.length();
  const theta = Math.atan2(offset.x, offset.z) - deltaX * 0.007;
  let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius))) - deltaY * 0.007;
  phi = Math.max(0.14, Math.min(Math.PI / 2 - 0.05, phi));

  camera.position.x = center.x + radius * Math.sin(phi) * Math.sin(theta);
  camera.position.y = center.y + radius * Math.cos(phi);
  camera.position.z = center.z + radius * Math.sin(phi) * Math.cos(theta);
  camera.lookAt(center);
}

/**
 * RESTRICCIÓN DE NO CAMBIO DE LUGAR
 */
function setupRaycastSelection() {
  const dom = renderer.domElement;
  let tapStartTime = 0;
  let downPos = { x: 0, y: 0 };

  dom.addEventListener('pointerdown', (e) => {
    tapStartTime = Date.now();
    downPos = { x: e.clientX, y: e.clientY };
  });

  dom.addEventListener('pointerup', (e) => {
    const moveDist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (Date.now() - tapStartTime > 280 || moveDist > 8) return;

    const rect = dom.getBoundingClientRect();
    mouseCoords.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseCoords.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseCoords, camera);
    const intersects = raycaster.intersectObjects(parkingGroup.children, true);

    for (let hit of intersects) {
      let current = hit.object;
      while (current && !current.userData.bayCode && current.parent) {
        current = current.parent;
      }
      if (current && current.userData.bayCode) {
        const code = current.userData.bayCode;
        const entry = bayMeshesMap[code];
        if (code === AppState.selectedBay) {
          setCameraBay();
        } else if (entry && entry.data && !entry.data.occupied && !entry.data.isAnimating) {
          requestBaySelection(code, entry.lotId, entry.levelId, getSelectedArrivalWindow());
        } else {
          showRestrictionAlert(code, 'occupied');
        }
        break;
      }
    }
  });
}

function showRestrictionAlert(clickedCode, reason = 'occupied') {
  const toast = document.getElementById('restrictionToast');
  if (!toast) return;
  const span = toast.querySelector('span');
  if (span) {
    if (reason === 'expired') {
      span.innerText = `Tiempo expirado en #${clickedCode}: debes seleccionar otro cajón diferente (sin aumentar tolerancia).`;
    } else if (reason === 'expired_blocked') {
      span.innerText = `No puedes volver a seleccionar #${clickedCode} porque tu tiempo expiró ahí. Elige otro cajón.`;
    } else if (reason === 'far_no_tolerance') {
      span.innerText = `Estás demasiado lejos del campus: no se permite aumento de tolerancia.`;
    } else if (reason === 'no_increase_expired') {
      span.innerText = `Tu tiempo expiró: no puedes aumentar tolerancia. Selecciona otro cajón.`;
    } else if (reason === 'tolerance_already_used') {
      span.innerText = `Ya utilizaste tu aumento de tolerancia (+3 min) para este cajón.`;
    } else if (reason === 'no_active_res') {
      span.innerText = `Primero selecciona y confirma un cajón libre.`;
    } else if (reason === 'gps_unsupported' || reason === 'gps_denied') {
      span.innerText = `No se pudo obtener GPS real; usa el selector Cerca / Lejos del campus.`;
    } else if (reason === 'secured') {
      span.innerText = `¡Llegada confirmada! Tu cajón #${clickedCode} está ocupado y asegurado.`;
    } else {
      span.innerText = clickedCode
        ? `Cajón #${clickedCode} ocupado. Selecciona un cajón libre para agendarlo.`
        : `Selecciona un cajón libre para agendarlo con tiempo límite de llegada.`;
    }
  }
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

/**
 * RECONSTRUCCIÓN 3D UNIFICADA DE LOS 3 ESTACIONAMIENTOS EN UN SOLO PLANO
 */
function rebuildParking3D() {
  Object.values(ParkingInventory).forEach(lot => {
    Object.values(lot).forEach(floor => {
      Object.values(floor).forEach(bay => {
        bay.isAnimating = false;
      });
    });
  });

  if (parkingGroup) {
    scene.remove(parkingGroup);
    parkingGroup.traverse(child => {
      if (child.geometry && (!SharedAssets || !SharedAssets.geometries.includes(child.geometry))) {
        child.geometry.dispose();
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!SharedAssets || !SharedAssets.materials.includes(m)) m.dispose();
        });
      }
    });
  }

  const colors = getPBRColors();
  initSharedAssets(colors);

  parkingGroup = new THREE.Group();
  lotGroups = {
    1: new THREE.Group(),
    2: new THREE.Group(),
    3: new THREE.Group()
  };
  centralFloorVisuals = {};
  bayMeshesMap = {};
  activeCarAnimations = [];
  carIndicatorMesh = null;
  navigationPathLine = null;

  Object.keys(lotGroups).forEach(id => {
    const cfg = LOT_LAYOUT[id];
    lotGroups[id].position.set(cfg.x, cfg.y, cfg.z);
    lotGroups[id].rotation.y = cfg.rotY || 0;
    parkingGroup.add(lotGroups[id]);
  });

  buildCampusEnvironment(colors);
  buildCentralWithDiagramArchitecture(colors, lotGroups[1]);
  buildLienzoCharro(colors, lotGroups[2]);
  buildInteriorCampus(colors, lotGroups[3]);

  buildNavigationInternalRoute(colors);
  scene.add(parkingGroup);
  updateInventoryStatsUI();
}

function createZoneLabelSign(text, x, y, z, colors, rotY = 0, scale = 1.0) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');

  const isDark = AppState.theme === 'dark';
  ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = isDark ? 'rgba(59, 130, 246, 0.65)' : 'rgba(29, 78, 216, 0.45)';
  ctx.lineWidth = 5;

  const r = 20;
  ctx.beginPath();
  ctx.moveTo(r, 6);
  ctx.lineTo(506 - r, 6);
  ctx.quadraticCurveTo(506, 6, 506, 6 + r);
  ctx.lineTo(506, 106 - r);
  ctx.quadraticCurveTo(506, 106, 506 - r, 106);
  ctx.lineTo(r, 106);
  ctx.quadraticCurveTo(6, 106, 6, 106 - r);
  ctx.lineTo(6, 6 + r);
  ctx.quadraticCurveTo(6, 6, r, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
  ctx.font = '700 36px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 56);

  const tex = SharedAssets.trackTex(new THREE.CanvasTexture(canvas));
  tex.anisotropy = 4;
  const mat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  const geo = SharedAssets.trackGeo(new THREE.PlaneGeometry(11.5 * scale, 2.5 * scale));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotY;
  mesh.position.set(x, y, z);
  parkingGroup.add(mesh);
}

/**
 * 1. ENTORNO 3D UNIFICADO DEL CAMPUS UNIVERSITARIO (SEGÚN PLANO)
 */
function buildCampusEnvironment(colors) {
  const groundGeo = new THREE.PlaneGeometry(170, 138);
  const groundMat = new THREE.MeshStandardMaterial({
    color: colors.groundPlane,
    roughness: 0.92,
    metalness: 0.04
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(0, -0.26, -19);
  groundMesh.receiveShadow = false;
  parkingGroup.add(groundMesh);

  const gardenMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({
    color: colors.campusGreen,
    roughness: 0.88,
    metalness: 0.04
  }));

  // Explanada Verde Norte: Universidad (Norte de la avenida horizontal Z = -21, Este de calle izq X = -47)
  const univZoneGeo = new THREE.PlaneGeometry(95, 34);
  const univZone = new THREE.Mesh(univZoneGeo, gardenMat);
  univZone.rotation.x = -Math.PI / 2;
  univZone.position.set(5, -0.22, -42.5);
  parkingGroup.add(univZone);

  // Áreas verdes laterales
  const gardenSideGeo = new THREE.PlaneGeometry(8, 44);
  const gardenW = new THREE.Mesh(gardenSideGeo, gardenMat);
  gardenW.rotation.x = -Math.PI / 2;
  gardenW.position.set(-55, -0.22, -14);
  parkingGroup.add(gardenW);

  const gardenE = new THREE.Mesh(gardenSideGeo, gardenMat);
  gardenE.rotation.x = -Math.PI / 2;
  gardenE.position.set(57, -0.22, 0);
  parkingGroup.add(gardenE);

  // RED VIAL PRINCIPAL (Asfalto oscuro + líneas amarillas discontinuas como en la imagen)
  const roadMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({
    color: colors.roadAsphalt,
    roughness: 0.78,
    metalness: 0.08
  }));

  // 1) Avenida Horizontal Este-Oeste (Z = -21)
  const hStreet = new THREE.Mesh(new THREE.PlaneGeometry(126, 7.6), roadMat);
  hStreet.rotation.x = -Math.PI / 2;
  hStreet.position.set(0, -0.21, -21);
  parkingGroup.add(hStreet);

  // 2) Avenida Vertical Izquierda Norte-Sur (X = -47, cruce en '+' con la horizontal)
  const vStreetLeft = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 88), roadMat);
  vStreetLeft.rotation.x = -Math.PI / 2;
  vStreetLeft.position.set(-47, -0.205, -20);
  parkingGroup.add(vStreetLeft);

  // 3) Calle Vertical Central-Sur (X = -6.2, intersección en 'T' hacia el Sur separando Lienzo Charro y Principal; ambas entradas apuntan aquí)
  const vStreetMid = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 56), roadMat);
  vStreetMid.rotation.x = -Math.PI / 2;
  vStreetMid.position.set(-6.2, -0.205, 6.5);
  parkingGroup.add(vStreetMid);

  // 4) Vialidad / Borde Este hacia Universidad (X = 36, lado derecho de Estacionamiento Principal rotado)
  const vStreetEast = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 56), roadMat);
  vStreetEast.rotation.x = -Math.PI / 2;
  vStreetEast.position.set(36, -0.205, 6.5);
  parkingGroup.add(vStreetEast);

  // Conectores de acceso desde la calle central (X = -6.2) hacia Lienzo Charro y Estacionamiento Principal
  const connLienzo = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 5.5), roadMat);
  connLienzo.rotation.x = -Math.PI / 2;
  connLienzo.position.set(-8.5, -0.19, 1.5);
  parkingGroup.add(connLienzo);

  const connMain = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 5.6), roadMat);
  connMain.rotation.x = -Math.PI / 2;
  connMain.position.set(-4.0, -0.19, 1.3);
  parkingGroup.add(connMain);

  // Acceso Interior Campus / Universidad (Lateral Oeste contrario -> vStreetLeft X = -47)
  const connInterior = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 5.2), roadMat);
  connInterior.rotation.x = -Math.PI / 2;
  connInterior.position.set(-43.5, -0.19, -41);
  parkingGroup.add(connInterior);

  // Pasos peatonales a nivel de banqueta:
  // 1) Frente a la salida de alumnos del Estacionamiento Principal (X = 6.5)
  // 2) Centrado respecto a la calle de entrada/salida de los estacionamientos (X = -6.2) hacia la entrada peatonal de Universidad
  const sidewalkMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({
    color: colors.planterCurb,
    roughness: 0.72,
    metalness: 0.08
  }));
  const pedDeckPrincipal = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(4.4, 0.22, 9.6)), sidewalkMat);
  pedDeckPrincipal.position.set(6.5, -0.11, -20.6);
  parkingGroup.add(pedDeckPrincipal);

  const pedDeckUnivCenter = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(5.0, 0.22, 9.6)), sidewalkMat);
  pedDeckUnivCenter.position.set(-6.2, -0.11, -20.8);
  parkingGroup.add(pedDeckUnivCenter);

  // INSTANCED MESH: Líneas amarillas discontinuas en las vialidades (1 solo draw call)
  const dashTransforms = [];
  const dummy = new THREE.Object3D();

  for (let x = -58; x <= 58; x += 4.5) {
    if (Math.abs(x - 6.5) < 2.6 || Math.abs(x - (-6.2)) < 2.8) continue;
    dummy.position.set(x, -0.185, -21);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    dashTransforms.push(dummy.matrix.clone());
  }
  for (let z = -60; z <= 32; z += 4.5) {
    if (Math.abs(z - (-21)) < 2.8) continue;
    dummy.position.set(-47, -0.185, z);
    dummy.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    dummy.updateMatrix();
    dashTransforms.push(dummy.matrix.clone());
  }
  for (let z = -15.5; z <= 33; z += 4.5) {
    dummy.position.set(-6.2, -0.185, z);
    dummy.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    dummy.updateMatrix();
    dashTransforms.push(dummy.matrix.clone());
  }
  for (let z = -15.5; z <= 33; z += 4.5) {
    dummy.position.set(36, -0.185, z);
    dummy.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    dummy.updateMatrix();
    dashTransforms.push(dummy.matrix.clone());
  }

  const dashGeo = SharedAssets.trackGeo(new THREE.PlaneGeometry(2.2, 0.22));
  const dashMat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  const dashInstanced = new THREE.InstancedMesh(dashGeo, dashMat, dashTransforms.length);
  dashTransforms.forEach((m, idx) => dashInstanced.setMatrixAt(idx, m));
  dashInstanced.instanceMatrix.needsUpdate = true;
  parkingGroup.add(dashInstanced);

  // INSTANCED MESH: Franjas blancas de los pasos peatonales a nivel de banqueta hacia Universidad (1 solo draw call)
  const zebraTransforms = [];
  [6.5, -6.2].forEach(zx => {
    for (let c = -1.6; c <= 1.65; c += 0.8) {
      dummy.position.set(zx + c, 0.015, -20.8);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      zebraTransforms.push(dummy.matrix.clone());
    }
  });
  const zebraGeo = SharedAssets.trackGeo(new THREE.PlaneGeometry(0.45, 5.4));
  const zebraMat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
  const zebraInstanced = new THREE.InstancedMesh(zebraGeo, zebraMat, zebraTransforms.length);
  zebraTransforms.forEach((m, idx) => zebraInstanced.setMatrixAt(idx, m));
  zebraInstanced.instanceMatrix.needsUpdate = true;
  parkingGroup.add(zebraInstanced);

  // Edificio arquitectónico de la Universidad (en el cuadrante Norte junto a Interior Campus)
  buildUniversidadCampusBlock(colors);

  // Etiquetas de zona en el plano 3D (Universidad, Lienzo Charro, Estacionamiento Principal)
  createZoneLabelSign('Universidad', 16, 0.05, -28.5, colors, 0, 1.15);
  createZoneLabelSign('Lienzo Charro', -25.5, 0.25, 19.5, colors, 0, 1.05);
  createZoneLabelSign('Estacionamiento Principal', 13, 0.25, 35.0, colors, 0, 1.2);

  // Árboles perimetrales (usando geometrías y materiales compartidos)
  const perimeterTrees = [
    [-42, -16], [-42, -5], [-42, 6], [-42, 16],
    [-11, -15], [-11, 18],
    [40, -15], [40, -4], [40, 7], [40, 20],
    [-38, -28], [-38, -40], [-38, -52],
    [12, -54], [24, -54], [36, -54], [46, -42]
  ];
  perimeterTrees.forEach(([tx, tz], idx) => {
    createLowPolyTree(tx, tz, colors, 0.95 + (idx % 3) * 0.12);
  });

  const lampPositions = [
    [-36, -17], [-26, -17], [-15, -17],
    [3, -17], [14, -17], [25, -17], [36, -17], [47, -17],
    [-20, -25], [0, -25], [20, -25]
  ];
  lampPositions.forEach(([lx, lz]) => {
    createArchitecturalLightPole(lx, lz);
  });
}

function buildUniversidadCampusBlock(colors) {
  const bldgGroup = new THREE.Group();
  bldgGroup.position.set(14, 0, -42);

  const plaza = new THREE.Mesh(
    SharedAssets.trackGeo(new THREE.BoxGeometry(48, 0.22, 24)),
    SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.planterCurb, roughness: 0.78 }))
  );
  plaza.position.set(0, -0.11, 1);
  bldgGroup.add(plaza);

  const wallMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.floor, roughness: 0.55, metalness: 0.1 }));
  const borderMat = SharedAssets.trackMat(new THREE.LineBasicMaterial({ color: colors.floorBorder }));
  const glassMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.15, metalness: 0.75, transparent: true, opacity: 0.72 }));

  const mainWingGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(26, 6.2, 10));
  const mainWing = new THREE.Mesh(mainWingGeo, wallMat);
  mainWing.position.set(6, 3.1, -2);
  bldgGroup.add(mainWing);
  const mainEdges = new THREE.LineSegments(SharedAssets.trackGeo(new THREE.EdgesGeometry(mainWingGeo)), borderMat);
  mainEdges.position.copy(mainWing.position);
  bldgGroup.add(mainEdges);

  const glassBand = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(26.2, 1.4, 10.2)), glassMat);
  glassBand.position.set(6, 3.6, -2);
  bldgGroup.add(glassBand);

  const eastWingGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(8, 4.4, 14));
  const eastWing = new THREE.Mesh(eastWingGeo, wallMat);
  eastWing.position.set(16, 2.2, 1);
  bldgGroup.add(eastWing);
  const eastEdges = new THREE.LineSegments(SharedAssets.trackGeo(new THREE.EdgesGeometry(eastWingGeo)), borderMat);
  eastEdges.position.copy(eastWing.position);
  bldgGroup.add(eastEdges);

  // Entrada Peatonal de la Universidad centrada respecto a la calle de los estacionamientos (world X = -6.2 -> local X = -20.2)
  const gateX = -20.2;
  const walkway = new THREE.Mesh(
    SharedAssets.trackGeo(new THREE.BoxGeometry(4.8, 0.06, 11.5)),
    SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.floorInactive, roughness: 0.7 }))
  );
  walkway.position.set(gateX, 0.03, 10.8);
  bldgGroup.add(walkway);

  const pillarGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.65, 3.6, 0.65));
  const pillarMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4, metalness: 0.25 }));
  const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
  pillarL.position.set(gateX - 2.2, 1.8, 15.8);
  const pillarR = new THREE.Mesh(pillarGeo, pillarMat);
  pillarR.position.set(gateX + 2.2, 1.8, 15.8);
  bldgGroup.add(pillarL, pillarR);

  const archBeam = new THREE.Mesh(
    SharedAssets.trackGeo(new THREE.BoxGeometry(5.6, 0.65, 0.85)),
    SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: 0xf5b800, roughness: 0.35, metalness: 0.3 }))
  );
  archBeam.position.set(gateX, 3.85, 15.8);
  bldgGroup.add(archBeam);

  parkingGroup.add(bldgGroup);
}

function createLowPolyTree(x, z, colors, scale = 1.0, baseY = -0.2, targetGroup = parkingGroup) {
  const treeGroup = new THREE.Group();

  const trunk = new THREE.Mesh(SharedAssets.treeGeos.trunk, SharedAssets.treeMats.trunk);
  trunk.position.y = 0.82;
  treeGroup.add(trunk);

  const foliage1 = new THREE.Mesh(SharedAssets.treeGeos.f1, SharedAssets.treeMats.dark);
  foliage1.position.y = 2.15;
  treeGroup.add(foliage1);

  const foliage2 = new THREE.Mesh(SharedAssets.treeGeos.f2, SharedAssets.treeMats.light);
  foliage2.position.y = 3.0;
  foliage2.rotation.y = 0.45;
  treeGroup.add(foliage2);

  const foliage3 = new THREE.Mesh(SharedAssets.treeGeos.f3, SharedAssets.treeMats.dark);
  foliage3.position.y = 3.68;
  treeGroup.add(foliage3);

  treeGroup.scale.setScalar(scale);
  treeGroup.position.set(x, baseY, z);
  targetGroup.add(treeGroup);
}

function createTreePlanterIsland(x, y, z, width, depth, colors, treeOffsets = [[0, 0]], targetGroup = parkingGroup) {
  const islandGroup = new THREE.Group();

  const curbGeo = new THREE.BoxGeometry(width, 0.16, depth);
  const curbMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.planterCurb, roughness: 0.7, metalness: 0.1 }));
  const curb = new THREE.Mesh(curbGeo, curbMat);
  curb.position.y = 0.08;
  islandGroup.add(curb);

  const grassGeo = new THREE.BoxGeometry(Math.max(0.4, width - 0.24), 0.18, Math.max(0.4, depth - 0.24));
  const grassMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.campusGreen, roughness: 0.85, metalness: 0.05 }));
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.position.y = 0.09;
  islandGroup.add(grass);

  islandGroup.position.set(x, y, z);
  targetGroup.add(islandGroup);

  treeOffsets.forEach(([ox, oz], idx) => {
    createLowPolyTree(x + ox, z + oz, colors, 0.88 + (idx % 2) * 0.1, y + 0.14, targetGroup);
  });
}

function createArchitecturalLightPole(x, z) {
  const poleGroup = new THREE.Group();
  const pole = new THREE.Mesh(SharedAssets.lampGeos.pole, SharedAssets.lampMats.pole);
  pole.position.y = 2.25;
  poleGroup.add(pole);

  const head = new THREE.Mesh(SharedAssets.lampGeos.head, SharedAssets.lampMats.pole);
  head.position.set(0.3, 4.5, 0);
  poleGroup.add(head);

  const bulb = new THREE.Mesh(SharedAssets.lampGeos.bulb, SharedAssets.lampMats.bulb);
  bulb.position.set(0.3, 4.44, 0);
  poleGroup.add(bulb);

  poleGroup.position.set(x, -0.2, z);
  parkingGroup.add(poleGroup);
}

const CENTRAL_BLDG_X = -11.0;

/**
 * 2. EDIFICIO CENTRAL MULTINIVEL (OESTE) + EXPLANADA ABIERTA PB (ESTE) SEGÚN PLANO DE REFERENCIA
 */
function buildCentralWithDiagramArchitecture(colors, targetGroup) {
  const floorWidth = 26;
  const floorDepth = 30;
  const levelHeight = 4.2;

  const levels = [
    { id: 'PB', y: 0 },
    { id: 'P1', y: levelHeight },
    { id: 'P2', y: levelHeight * 2 }
  ];

  centralFloorVisuals = {
    PB: { floorMats: [], edgeMats: [], roadMats: [], wingMats: [] },
    P1: { floorMats: [], edgeMats: [], roadMats: [], wingMats: [] },
    P2: { floorMats: [], edgeMats: [], roadMats: [], wingMats: [] }
  };

  buildGroundFloorOpenAirWings(colors, AppState.selectedLevel === 'PB', targetGroup);

  levels.forEach((lvl, lvlIndex) => {
    const isCurrentLevel = AppState.selectedLevel === lvl.id;
    const isPB = lvl.id === 'PB';
    const floorY = lvl.y;

    const floorGeo = new THREE.BoxGeometry(floorWidth, 0.35, floorDepth);
    const floorMat = new THREE.MeshStandardMaterial({
      color: isCurrentLevel ? colors.floor : colors.floorInactive,
      roughness: 0.65,
      metalness: 0.12,
      transparent: true,
      opacity: isCurrentLevel ? 0.98 : 0.62
    });
    centralFloorVisuals[lvl.id].floorMats.push(floorMat);

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(CENTRAL_BLDG_X, floorY, 0);
    floorMesh.receiveShadow = !isPB;
    floorMesh.castShadow = false;
    targetGroup.add(floorMesh);

    const edgesGeo = new THREE.EdgesGeometry(floorGeo);
    const edgesMat = new THREE.LineBasicMaterial({
      color: isCurrentLevel ? colors.floorBorderActive : colors.floorBorder,
      linewidth: isCurrentLevel ? 2 : 1
    });
    centralFloorVisuals[lvl.id].edgeMats.push(edgesMat);

    const edgesMesh = new THREE.LineSegments(edgesGeo, edgesMat);
    edgesMesh.position.set(CENTRAL_BLDG_X, floorY, 0);
    targetGroup.add(edgesMesh);

    const roadMat = buildFloorRoadNetwork(floorY + 0.18, floorWidth, floorDepth, colors, isCurrentLevel, isPB, targetGroup);
    centralFloorVisuals[lvl.id].roadMats.push(roadMat);

    if (lvlIndex < 2) {
      buildDiagramCentralRamp(floorY, levelHeight, colors, targetGroup);
      buildStructuralColumns(floorY, levelHeight, colors, targetGroup);
    }

    renderDiagramBaysForFloor(floorY + 0.19, colors, lvl.id, isCurrentLevel, targetGroup);
  });

  // Escaleras según imagen de referencia:
  // 1) Esquina Noroeste del edificio cubierto
  buildStaircaseCore(CENTRAL_BLDG_X - 11.5, -13.2, levelHeight * 2 + 1.2, colors, targetGroup);
  // 2) Borde Este del edificio cubierto (al sur de "Entrada a PB, N1 y N2")
  buildStaircaseCore(CENTRAL_BLDG_X + 11.6, 4.2, levelHeight * 2 + 1.2, colors, targetGroup);

  // Portal "Entrada a PB, N1 y N2" (bloque terracota en el borde Este del edificio)
  const portalMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: 0x8b4533, roughness: 0.6, metalness: 0.15 }));
  const portalMesh = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(2.8, 3.2, 4.4)), portalMat);
  portalMesh.position.set(CENTRAL_BLDG_X + 11.6, 1.6, -5.8);
  targetGroup.add(portalMesh);
}

function updateCentralLevelsVisualState() {
  const colors = getPBRColors();
  const activeLvl = AppState.selectedLevel;

  ['PB', 'P1', 'P2'].forEach(lvlId => {
    const isCurrent = (lvlId === activeLvl);
    const vis = centralFloorVisuals[lvlId];
    if (!vis) return;

    vis.floorMats.forEach(m => {
      m.color.setHex(isCurrent ? colors.floor : colors.floorInactive);
      m.opacity = isCurrent ? 0.98 : 0.62;
    });
    vis.wingMats.forEach(m => {
      m.color.setHex(isCurrent ? colors.floorPBOpen : colors.floorInactive);
      m.opacity = isCurrent ? 0.98 : 0.72;
    });
    vis.edgeMats.forEach(m => {
      m.color.setHex(isCurrent ? colors.floorBorderActive : colors.floorBorder);
    });
    vis.roadMats.forEach(m => {
      m.opacity = isCurrent ? 0.96 : 0.52;
    });
  });

  Object.values(bayMeshesMap).forEach(entry => {
    if (entry.lotId !== 1) return;
    const isLevelActive = (entry.levelId === activeLvl);
    entry.isLevelActive = isLevelActive;
    const isSelected = (AppState.selectedBay === entry.code);
    const isOccupied = entry.data.occupied && !isSelected;
    entry.bayMesh.material = SharedAssets.getBayMat(isSelected, isOccupied, isLevelActive);
    if (entry.carMesh && !entry.data.isAnimating) {
      setCarMeshOpacity(entry.carMesh, isLevelActive ? 1.0 : 0.52);
    }
  });
}

function buildGroundFloorOpenAirWings(colors, isPBActive, targetGroup) {
  const wingWidth = 22.0;
  const wingDepth = 30.0;
  const wingCenterX = 13.0; // X de +2.0 a +24.0 (mitad Este del Estacionamiento Principal)
  const wingY = 0;

  const wingGeo = new THREE.BoxGeometry(wingWidth, 0.32, wingDepth);
  const wingMat = new THREE.MeshStandardMaterial({
    color: isPBActive ? colors.floorPBOpen : colors.floorInactive,
    roughness: 0.68,
    metalness: 0.08,
    transparent: true,
    opacity: isPBActive ? 0.98 : 0.72
  });
  centralFloorVisuals.PB.wingMats.push(wingMat);

  const wingMesh = new THREE.Mesh(wingGeo, wingMat);
  wingMesh.position.set(wingCenterX, wingY, 0);
  targetGroup.add(wingMesh);

  const wingEdgeMat = new THREE.LineBasicMaterial({ color: isPBActive ? colors.floorBorderActive : colors.floorBorder });
  centralFloorVisuals.PB.edgeMats.push(wingEdgeMat);

  const wingEdges = new THREE.LineSegments(new THREE.EdgesGeometry(wingGeo), wingEdgeMat);
  wingEdges.position.set(wingCenterX, wingY, 0);
  targetGroup.add(wingEdges);

  // Caseta de control en Entrada/Salida vehículos (Norte-Oeste de la mitad Este)
  const boothMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: 0x3b7a75, roughness: 0.55, metalness: 0.15 }));
  const booth = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(2.6, 2.2, 3.6)), boothMat);
  booth.position.set(6.7, 1.1, -12.6);
  targetGroup.add(booth);

  // Flechas amarillas de Entrada y Salida vehicular sobre el pavimento
  const yellowArrowMat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  const arrowShaftH = SharedAssets.trackGeo(new THREE.BoxGeometry(4.2, 0.04, 0.24));
  const arrowShaftV = SharedAssets.trackGeo(new THREE.BoxGeometry(0.24, 0.04, 3.8));
  const arrowHeadGeo = SharedAssets.trackGeo(new THREE.ConeGeometry(0.42, 0.75, 3));

  // Flecha de Entrada (entra desde Norte en X=4.2 y gira al Oeste hacia Entrada PB/N1/N2)
  const inV = new THREE.Mesh(arrowShaftV, yellowArrowMat);
  inV.position.set(4.2, 0.21, -12.2);
  const inH = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(1.6, 0.04, 0.24)), yellowArrowMat);
  inH.position.set(3.5, 0.21, -10.4);
  const inHead = new THREE.Mesh(arrowHeadGeo, yellowArrowMat);
  inHead.rotation.z = Math.PI / 2;
  inHead.position.set(2.5, 0.21, -10.4);
  targetGroup.add(inV, inH, inHead);

  // Flecha de Salida (sale desde la zona Este hacia el Norte en X=9.2)
  const outH = new THREE.Mesh(arrowShaftH, yellowArrowMat);
  outH.position.set(6.8, 0.21, -7.2);
  const outV = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(0.24, 0.04, 5.4)), yellowArrowMat);
  outV.position.set(8.9, 0.21, -9.8);
  const outHead = new THREE.Mesh(arrowHeadGeo, yellowArrowMat);
  outHead.rotation.x = -Math.PI / 2;
  outHead.position.set(8.9, 0.21, -12.8);
  targetGroup.add(outH, outV, outHead);

  // Flecha blanca de Salida peatonal hacia el Este (Universidad)
  const whiteMat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const pedShaft = new THREE.Mesh(SharedAssets.trackGeo(new THREE.BoxGeometry(2.2, 0.04, 0.22)), whiteMat);
  pedShaft.position.set(22.2, 0.21, -6.5);
  const pedHead = new THREE.Mesh(arrowHeadGeo, whiteMat);
  pedHead.rotation.z = -Math.PI / 2;
  pedHead.position.set(23.5, 0.21, -6.5);
  targetGroup.add(pedShaft, pedHead);

  // 2 Camellones verdes verticales con árboles (según imagen de referencia)
  const planterY = 0.17;
  createTreePlanterIsland(9.0, planterY, 5.8, 1.35, 16.2, colors, [[0, -5.5], [0, 0], [0, 5.5]], targetGroup);
  createTreePlanterIsland(18.0, planterY, 5.8, 1.35, 16.2, colors, [[0, -5.5], [0, 0], [0, 5.5]], targetGroup);
}

function buildFloorRoadNetwork(yPos, width, depth, colors, isCurrentLevel, isPB = false, targetGroup = parkingGroup) {
  const roadMat = new THREE.MeshStandardMaterial({
    color: colors.roadAsphalt,
    roughness: 0.8,
    metalness: 0.08,
    transparent: true,
    opacity: isCurrentLevel ? 0.96 : 0.52
  });

  const laneGeo = new THREE.PlaneGeometry(3.5, depth - 1.6);
  const laneW = new THREE.Mesh(laneGeo, roadMat);
  laneW.rotation.x = -Math.PI / 2;
  laneW.position.set(CENTRAL_BLDG_X - 7.4, yPos, 0);
  laneW.receiveShadow = !isPB;
  targetGroup.add(laneW);

  const laneE = new THREE.Mesh(laneGeo, roadMat);
  laneE.rotation.x = -Math.PI / 2;
  laneE.position.set(CENTRAL_BLDG_X + 7.4, yPos, 0);
  laneE.receiveShadow = !isPB;
  targetGroup.add(laneE);

  const laneNorthGeo = new THREE.PlaneGeometry(18.2, 2.2);
  const laneNorth = new THREE.Mesh(laneNorthGeo, roadMat);
  laneNorth.rotation.x = -Math.PI / 2;
  laneNorth.position.set(CENTRAL_BLDG_X, yPos, -13.0);
  laneNorth.receiveShadow = !isPB;
  targetGroup.add(laneNorth);

  const laneSouthGeo = new THREE.PlaneGeometry(18.2, 2.2);
  const laneSouth = new THREE.Mesh(laneSouthGeo, roadMat);
  laneSouth.rotation.x = -Math.PI / 2;
  laneSouth.position.set(CENTRAL_BLDG_X, yPos, 13.0);
  laneSouth.receiveShadow = !isPB;
  targetGroup.add(laneSouth);

  if (isPB) {
    // Pasillo distribuidor superior de la explanada Este (Z = -8.5)
    const eastTopAisle = new THREE.Mesh(new THREE.PlaneGeometry(24.0, 4.2), roadMat);
    eastTopAisle.rotation.x = -Math.PI / 2;
    eastTopAisle.position.set(11.5, yPos, -8.5);
    targetGroup.add(eastTopAisle);

    // 3 pasillos verticales de la explanada Este (Oeste, Centro, Este)
    [3.8, 13.5, 22.8].forEach(ax => {
      const vLane = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 22.0), roadMat);
      vLane.rotation.x = -Math.PI / 2;
      vLane.position.set(ax, yPos, 2.5);
      targetGroup.add(vLane);
    });

    // Conector principal Entrada/Salida hacia la avenida horizontal Norte (Z = -21)
    const connMain = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.0), roadMat);
    connMain.rotation.x = -Math.PI / 2;
    connMain.position.set(6.7, -0.19, -17.0);
    targetGroup.add(connMain);
  }

  return roadMat;
}

/**
 * Rampa Central Multinivel (Centrada al ancho del estacionamiento Z = 0.0 y rotada hacia Universidad +X):
 * - El pie inferior de la rampa (nivel floorY) está en X = bx - 5.0 (junto a laneW).
 * - La cima superior de la rampa (nivel floorY + levelHeight) está en X = bx + 5.0 (hacia la Universidad, junto a laneE).
 * - Carril Derecho en sentido +X (Z = +1.15, flecha verde): SUBIDA desde X = bx - 5.0 (floorY) hacia X = bx + 5.0 (floorY + levelHeight).
 * - Carril Derecho en sentido -X (Z = -1.15, flecha naranja): BAJADA desde X = bx + 5.0 (floorY + levelHeight) hacia X = bx - 5.0 (floorY).
 */
function buildDiagramCentralRamp(floorY, levelHeight, colors, targetGroup = parkingGroup) {
  const rampLength = 10.0;
  const rampWidth = 4.4;
  const rampZMid = 0.0; // Exactamente centrada al ancho del estacionamiento (Z de -15 a +15)
  const slopeAngle = Math.atan2(levelHeight, rampLength);

  const rampYawGroup = new THREE.Group();
  rampYawGroup.position.set(CENTRAL_BLDG_X, floorY + levelHeight / 2, rampZMid);
  // Rotada 90° para apuntar hacia +X local (Norte / Universidad en el plano 3D)
  rampYawGroup.rotation.y = Math.PI / 2;

  const rampContainer = new THREE.Group();
  rampContainer.rotation.x = -slopeAngle;
  rampYawGroup.add(rampContainer);

  const rampGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(rampWidth, 0.22, rampLength));
  const rampMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({
    color: colors.roadAsphalt,
    roughness: 0.75,
    metalness: 0.12
  }));
  const ramp = new THREE.Mesh(rampGeo, rampMat);
  ramp.castShadow = false;
  ramp.receiveShadow = false;
  rampContainer.add(ramp);

  // Divisor central de carriles sobre la rampa
  const dividerGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.14, 0.10, rampLength - 0.4));
  const dividerMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.roadMarking, roughness: 0.6 }));
  const divider = new THREE.Mesh(dividerGeo, dividerMat);
  divider.position.set(0, 0.15, 0);
  rampContainer.add(divider);

  // Barandales laterales integrados al plano de la rampa
  const railGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.12, 0.82, rampLength));
  const railMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.5 }));

  const railW = new THREE.Mesh(railGeo, railMat);
  railW.position.set(-rampWidth / 2 - 0.06, 0.42, 0);
  rampContainer.add(railW);

  const railE = new THREE.Mesh(railGeo, railMat);
  railE.position.set(rampWidth / 2 + 0.06, 0.42, 0);
  rampContainer.add(railE);

  // Bajo rotation.y = +PI/2: local -X -> +Z (Z = 9.85, subida hacia Universidad); local +X -> -Z (Z = 7.55, bajada)
  const upArrow = createLocalRampArrow(colors.rampUpArrow, 0);
  upArrow.position.set(-1.15, 0.14, 0);
  rampContainer.add(upArrow);

  const downArrow = createLocalRampArrow(colors.rampDownArrow, Math.PI);
  downArrow.position.set(1.15, 0.14, 0);
  rampContainer.add(downArrow);

  targetGroup.add(rampYawGroup);
}

function createLocalRampArrow(colorHex, rotY) {
  const arrowGroup = new THREE.Group();
  const arrowMat = SharedAssets.trackMat(new THREE.MeshBasicMaterial({ color: colorHex }));

  const shaftGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.32, 0.04, 1.5));
  const shaft = new THREE.Mesh(shaftGeo, arrowMat);
  arrowGroup.add(shaft);

  const headGeo = SharedAssets.trackGeo(new THREE.ConeGeometry(0.46, 0.85, 3));
  const head = new THREE.Mesh(headGeo, arrowMat);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0, 0.95);
  arrowGroup.add(head);

  arrowGroup.rotation.y = rotY;
  return arrowGroup;
}

function buildStructuralColumns(floorY, levelHeight, colors, targetGroup = parkingGroup) {
  const colGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.55, levelHeight, 0.55));
  const colMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.column, roughness: 0.6, metalness: 0.2 }));
  const baseGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(0.75, 0.25, 0.75));
  const baseMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.columnBase, roughness: 0.5, metalness: 0.3 }));

  const colPositions = [
    [CENTRAL_BLDG_X - 12.2, floorY + levelHeight / 2, -14.0],
    [CENTRAL_BLDG_X + 12.2, floorY + levelHeight / 2, -14.0],
    [CENTRAL_BLDG_X - 12.2, floorY + levelHeight / 2, 14.0],
    [CENTRAL_BLDG_X + 12.2, floorY + levelHeight / 2, 14.0],
    [CENTRAL_BLDG_X - 3.0, floorY + levelHeight / 2, -2.6],
    [CENTRAL_BLDG_X + 3.0, floorY + levelHeight / 2, 2.6]
  ];

  colPositions.forEach(pos => {
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(...pos);
    targetGroup.add(col);

    const colBase = new THREE.Mesh(baseGeo, baseMat);
    colBase.position.set(pos[0], floorY + 0.12, pos[2]);
    targetGroup.add(colBase);
  });
}

function renderDiagramBaysForFloor(yPos, colors, levelKey, isLevelActive, targetGroup) {
  const inventory = ParkingInventory[1][levelKey] || {};
  const bayWidth = 3.4;
  const bayDepth = 1.48;
  let bayIndex = 1;
  const bx = CENTRAL_BLDG_X;

  for (let i = 0; i < 12; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = -12.6 + i * 2.15;
    createDiagramBayMesh(code, inventory[code], bx - 10.8, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'W_OUT', bx - 7.4, 1, targetGroup);
  }

  for (let i = 0; i < 4; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = -10.4 + i * 2.20;
    createDiagramBayMesh(code, inventory[code], bx - 3.9, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'MID_N_L', bx - 7.4, 1, targetGroup);
  }

  for (let i = 0; i < 4; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = -10.4 + i * 2.20;
    createDiagramBayMesh(code, inventory[code], bx + 3.9, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'MID_N_R', bx + 7.4, 1, targetGroup);
  }

  for (let i = 0; i < 12; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = -12.6 + i * 2.15;
    createDiagramBayMesh(code, inventory[code], bx + 10.8, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'E_OUT', bx + 7.4, 1, targetGroup);
  }

  // 5 + 5 cajones al sur de la rampa centrada (Z = 3.3 .. 10.98)
  for (let i = 0; i < 5; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = 3.3 + i * 1.92;
    createDiagramBayMesh(code, inventory[code], bx - 3.9, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'MID_S_L', bx - 7.4, 1, targetGroup);
  }

  for (let i = 0; i < 5; i++) {
    const code = getBayCode(inventory, bayIndex++);
    const z = 3.3 + i * 1.92;
    createDiagramBayMesh(code, inventory[code], bx + 3.9, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'MID_S_R', bx + 7.4, 1, targetGroup);
  }

  if (levelKey === 'PB') {
    // 4 cajones perpendiculares arriba a la derecha (Norte de explanada Este)
    [12.8, 15.3, 17.8, 20.3].forEach(xTop => {
      const code = getBayCode(inventory, bayIndex++);
      createDiagramBayMesh(code, inventory[code], xTop, yPos, -12.6, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'PB_OPEN_TOP', xTop, 1, targetGroup, Math.PI / 2);
    });

    // 28 cajones horizontales a ambos lados de los 2 camellones verticales (7 por lado x 4 columnas)
    const zPlanterRows = [-1.1, 1.2, 3.5, 5.8, 8.1, 10.4, 12.7];

    zPlanterRows.forEach(z => {
      const code = getBayCode(inventory, bayIndex++);
      createDiagramBayMesh(code, inventory[code], 6.4, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'PB_OPEN_P1_L', 3.8, 1, targetGroup);
    });
    zPlanterRows.forEach(z => {
      const code = getBayCode(inventory, bayIndex++);
      createDiagramBayMesh(code, inventory[code], 11.4, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'PB_OPEN_P1_R', 13.5, 1, targetGroup);
    });
    zPlanterRows.forEach(z => {
      const code = getBayCode(inventory, bayIndex++);
      createDiagramBayMesh(code, inventory[code], 15.5, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'PB_OPEN_P2_L', 13.5, 1, targetGroup);
    });
    zPlanterRows.forEach(z => {
      const code = getBayCode(inventory, bayIndex++);
      createDiagramBayMesh(code, inventory[code], 20.5, yPos, z, bayWidth, bayDepth, colors, isLevelActive, levelKey, 'PB_OPEN_P2_R', 22.8, 1, targetGroup);
    });
  }
}

function getBayCode(inventory, idx) {
  const keys = Object.keys(inventory);
  return keys[idx - 1] || `B-${idx}`;
}

function createDiagramBayMesh(code, bayData, x, y, z, width, depth, colors, isLevelActive, levelId, zoneType, aisleX = 0, lotId = 1, targetGroup = parkingGroup, rotYOverride = null) {
  if (!bayData) return;
  const isSelected = AppState.selectedBay === code;
  const isOccupied = bayData.occupied && !isSelected;
  const isPB = (levelId === 'PB');
  const isFlat = (lotId !== 1);

  const bayGeo = isFlat ? SharedAssets.bayGeoFlat : SharedAssets.bayGeoCentral;
  const bayMat = SharedAssets.getBayMat(isSelected, isOccupied, isLevelActive);

  const bayMesh = new THREE.Mesh(bayGeo, bayMat);
  bayMesh.rotation.x = -Math.PI / 2;
  if (rotYOverride !== null) bayMesh.rotation.z = rotYOverride;
  bayMesh.position.set(x, y, z);
  bayMesh.receiveShadow = (lotId === 1 && !isPB);
  bayMesh.castShadow = false;
  bayMesh.userData.bayCode = code;
  targetGroup.add(bayMesh);

  const borderGeo = isFlat ? SharedAssets.bayBorderGeoFlat : SharedAssets.bayBorderGeoCentral;
  const borderMat = isSelected ? SharedAssets.bayBorderMatSelected : SharedAssets.bayBorderMatDefault;
  const borderMesh = new THREE.LineSegments(borderGeo, borderMat);
  borderMesh.rotation.x = -Math.PI / 2;
  if (rotYOverride !== null) borderMesh.rotation.z = rotYOverride;
  borderMesh.position.set(x, y + 0.012, z);
  borderMesh.userData.bayCode = code;
  targetGroup.add(borderMesh);

  const stopperMat = isSelected ? SharedAssets.stopperMatSelected : SharedAssets.stopperMatDefault;
  const stopper = new THREE.Mesh(SharedAssets.stopperGeoCentral, stopperMat);
  if (rotYOverride !== null) {
    stopper.rotation.y = rotYOverride;
    const stopperDir = (zoneType === 'RAMP_N') ? 1 : -1;
    stopper.position.set(x, y + 0.04, z + stopperDir * (width * 0.38));
  } else {
    const stopperSign = (x < aisleX) ? -1 : 1;
    stopper.position.set(x + stopperSign * (width * 0.38), y + 0.04, z);
  }
  targetGroup.add(stopper);

  const carRotation = (rotYOverride !== null)
    ? ((zoneType === 'RAMP_N') ? 0 : Math.PI)
    : ((x < aisleX) ? -Math.PI / 2 : Math.PI / 2);
  let carMesh = null;

  if (isOccupied) {
    carMesh = createDetailedPBRCarMesh(x, y + 0.45, z, bayData.carColor || colors.carOccupied, carRotation, (lotId === 1 && !isPB), false);
    if (!isLevelActive) {
      setCarMeshOpacity(carMesh, 0.52);
    }
    carMesh.userData.bayCode = code;
    targetGroup.add(carMesh);
  }

  if (isSelected) {
    addAssignedCarMarker(x, y + 0.45, z, colors, carRotation, targetGroup);
  }

  const layout = LOT_LAYOUT[lotId] || LOT_LAYOUT[1];
  const rotY = layout.rotY || 0;
  const cosR = Math.cos(rotY);
  const sinR = Math.sin(rotY);
  bayMeshesMap[code] = {
    code,
    lotId,
    levelId,
    zoneType,
    aisleX,
    bayMesh,
    borderMesh,
    carMesh,
    x, y, z,
    worldX: layout.x + x * cosR + z * sinR,
    worldZ: layout.z - x * sinR + z * cosR,
    carRotation,
    data: bayData,
    isLevelActive
  };
}

function setCarMeshOpacity(carMesh, opacityVal) {
  if (!carMesh) return;
  const isTransparent = opacityVal < 0.99;
  const body = carMesh.userData && carMesh.userData.bodyMesh;
  if (body && body.material) {
    body.material.transparent = isTransparent;
    body.material.opacity = opacityVal;
  }
}

function buildLienzoCharro(colors, targetGroup) {
  const width = 30;
  const depth = 30;

  const floorGeo = new THREE.BoxGeometry(width, 0.25, depth);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: colors.floor, roughness: 0.8, metalness: 0.1 }));
  floor.receiveShadow = false;
  targetGroup.add(floor);

  const fence = new THREE.LineSegments(new THREE.EdgesGeometry(floorGeo), new THREE.LineBasicMaterial({ color: colors.fence }));
  targetGroup.add(fence);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, depth - 1.5),
    new THREE.MeshStandardMaterial({ color: colors.roadAsphalt, roughness: 0.8 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.14, 0);
  targetGroup.add(road);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), new THREE.MeshStandardMaterial({ color: colors.column, roughness: 0.6, metalness: 0.2 }));
  cabin.position.set(-12.5, 1.1, -13);
  targetGroup.add(cabin);

  renderFlatSurfaceBays(0.15, colors, 2, 'S', targetGroup);
}

function buildInteriorCampus(colors, targetGroup) {
  const width = 28;
  const depth = 26;

  const floorGeo = new THREE.BoxGeometry(width, 0.25, depth);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: colors.floor, roughness: 0.75, metalness: 0.15 }));
  floor.receiveShadow = false;
  targetGroup.add(floor);

  const fence = new THREE.LineSegments(new THREE.EdgesGeometry(floorGeo), new THREE.LineBasicMaterial({ color: colors.floorBorder }));
  targetGroup.add(fence);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, depth - 1.5),
    new THREE.MeshStandardMaterial({ color: colors.roadAsphalt, roughness: 0.8 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.14, 0);
  targetGroup.add(road);

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4, metalness: 0.4 }));
  post.position.set(-3.2, 0.7, 11.5);
  targetGroup.add(post);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.3, metalness: 0.5 }));
  arm.position.set(-1.5, 1.2, 11.5);
  targetGroup.add(arm);

  renderFlatSurfaceBays(0.15, colors, 3, 'S', targetGroup);
}

function renderFlatSurfaceBays(yPos, colors, lotId, levelKey, targetGroup) {
  const inventory = ParkingInventory[lotId][levelKey] || {};
  const bayWidth = 3.55;
  const bayDepth = 1.66;
  const keys = Object.keys(inventory);
  const half = Math.ceil(keys.length / 2);
  const zSpan = lotId === 3 ? 21.0 : 25.0;
  const zStart = lotId === 3 ? -10.5 : -12.5;

  keys.forEach((code, idx) => {
    const isLeft = idx < half;
    const rowIdx = isLeft ? idx : (idx - half);
    const x = isLeft ? -7.2 : 7.2;
    const z = zStart + rowIdx * (zSpan / Math.max(1, half - 1));
    createDiagramBayMesh(code, inventory[code], x, yPos, z, bayWidth, bayDepth, colors, true, 'S', 'FLAT', 0, lotId, targetGroup);
  });
}

function buildStaircaseCore(x, z, totalHeight, colors, targetGroup = parkingGroup) {
  const stairGroup = new THREE.Group();

  const coreWidth = 2.4;
  const coreDepth = 3.0;
  const coreGeo = new THREE.BoxGeometry(coreWidth, totalHeight, coreDepth);
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: colors.stairGlass,
    roughness: 0.2,
    transmission: 0.6,
    thickness: 0.8,
    transparent: true,
    opacity: 0.55
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.set(x, totalHeight / 2, z);
  stairGroup.add(coreMesh);

  const coreBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(coreGeo),
    new THREE.LineBasicMaterial({ color: colors.stairRailing })
  );
  coreBorder.position.copy(coreMesh.position);
  stairGroup.add(coreBorder);

  const numSteps = 16;
  const stepGeo = SharedAssets.trackGeo(new THREE.BoxGeometry(1.5, 0.08, 0.35));
  const stepMat = SharedAssets.trackMat(new THREE.MeshStandardMaterial({ color: colors.stairCore, roughness: 0.5, metalness: 0.3 }));

  for (let i = 0; i < numSteps; i++) {
    const step = new THREE.Mesh(stepGeo, stepMat);
    const stepY = (i / numSteps) * totalHeight;
    const stepZ = z - 1.1 + ((i % 8) * 0.3);
    step.position.set(x, stepY, stepZ);
    stairGroup.add(step);
  }

  const roofGeo = new THREE.BoxGeometry(coreWidth + 0.3, 0.15, coreDepth + 0.3);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: colors.column, roughness: 0.5, metalness: 0.2 }));
  roof.position.set(x, totalHeight + 0.08, z);
  stairGroup.add(roof);

  targetGroup.add(stairGroup);
}

/**
 * MODELADO 3D DE VEHÍCULO PBR OPTIMIZADO (GEOMETRÍAS Y MATERIALES COMPARTIDOS)
 */
function createDetailedPBRCarMesh(x, y, z, color, rotationY = 0, castShadowEnabled = false, useDynamicLights = false) {
  const carGroup = new THREE.Group();
  carGroup.rotation.order = 'YXZ';

  const bodyGroup = new THREE.Group();
  bodyGroup.rotation.order = 'YXZ';
  carGroup.add(bodyGroup);

  const geos = SharedAssets.carGeos;
  const sm = SharedAssets.carStaticMats;
  const baseMat = SharedAssets.getCarPaintMat(color);

  const base = new THREE.Mesh(geos.base, baseMat);
  base.position.y = 0.25;
  base.castShadow = castShadowEnabled;
  base.receiveShadow = false;
  bodyGroup.add(base);

  const bumper = new THREE.Mesh(geos.bumper, sm.bumper);
  bumper.position.y = 0.11;
  bodyGroup.add(bumper);

  const grille = new THREE.Mesh(geos.grille, sm.grille);
  grille.position.set(0, 0.23, 1.38);
  bodyGroup.add(grille);

  const cab = new THREE.Mesh(geos.cab, sm.cab);
  cab.position.set(0, 0.61, -0.12);
  bodyGroup.add(cab);

  const roof = new THREE.Mesh(geos.roof, baseMat);
  roof.position.set(0, 0.83, -0.12);
  bodyGroup.add(roof);

  const mirrorL = new THREE.Mesh(geos.mirror, baseMat);
  mirrorL.position.set(-0.67, 0.48, 0.38);
  const mirrorR = new THREE.Mesh(geos.mirror, baseMat);
  mirrorR.position.set(0.67, 0.48, 0.38);
  bodyGroup.add(mirrorL, mirrorR);

  const lightL = new THREE.Mesh(geos.light, sm.headLight);
  lightL.position.set(-0.41, 0.27, 1.38);
  const lightR = new THREE.Mesh(geos.light, sm.headLight);
  lightR.position.set(0.41, 0.27, 1.38);
  bodyGroup.add(lightL, lightR);

  const tailL = new THREE.Mesh(geos.tail, sm.brakeLight);
  tailL.position.set(-0.41, 0.28, -1.38);
  const tailR = new THREE.Mesh(geos.tail, sm.brakeLight);
  tailR.position.set(0.41, 0.28, -1.38);
  bodyGroup.add(tailL, tailR);

  const revL = new THREE.Mesh(geos.rev, sm.reverseLight);
  revL.position.set(-0.24, 0.27, -1.38);
  const revR = new THREE.Mesh(geos.rev, sm.reverseLight);
  revR.position.set(0.24, 0.27, -1.38);
  bodyGroup.add(revL, revR);

  const blinkFL = new THREE.Mesh(geos.blink, sm.blink);
  blinkFL.position.set(-0.57, 0.26, 1.37);
  const blinkRL = new THREE.Mesh(geos.blink, sm.blink);
  blinkRL.position.set(-0.57, 0.27, -1.37);
  const blinkFR = new THREE.Mesh(geos.blink, sm.blink);
  blinkFR.position.set(0.57, 0.26, 1.37);
  const blinkRR = new THREE.Mesh(geos.blink, sm.blink);
  blinkRR.position.set(0.57, 0.27, -1.37);
  bodyGroup.add(blinkFL, blinkRL, blinkFR, blinkRR);

  const wheelsList = [];
  const wheelPositions = [
    [-0.64, 0.15, 0.84, true],
    [0.64, 0.15, 0.84, true],
    [-0.64, 0.15, -0.84, false],
    [0.64, 0.15, -0.84, false]
  ];

  wheelPositions.forEach(([wx, wy, wz, isFront]) => {
    const steerGroup = new THREE.Group();
    steerGroup.position.set(wx, wy, wz);

    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(geos.tire, sm.tire);
    const rim = new THREE.Mesh(geos.rim, sm.rim);
    const spoke = new THREE.Mesh(geos.spoke, sm.rim);
    spinGroup.add(tire, rim, spoke);

    steerGroup.add(spinGroup);
    carGroup.add(steerGroup);
    wheelsList.push({ steerGroup, spinGroup, isFront });
  });

  carGroup.userData = {
    bodyGroup,
    wheels: wheelsList,
    lightMeshes: { lightL, lightR, tailL, tailR, revL, revR, blinkFL, blinkRL, blinkFR, blinkRR },
    lights: null
  };

  if (useDynamicLights) {
    ensureDynamicCarLights(carGroup);
  }

  carGroup.position.set(x, y, z);
  carGroup.rotation.y = rotationY;
  return carGroup;
}

function ensureDynamicCarLights(carMesh) {
  if (!carMesh || !carMesh.userData || carMesh.userData.lights) return;
  const sm = SharedAssets.carStaticMats;
  const m = carMesh.userData.lightMeshes;
  if (!m) return;

  const headLightMat = sm.headLight.clone();
  const brakeLightMat = sm.brakeLight.clone();
  const reverseLightMat = sm.reverseLight.clone();
  const blinkMatL = sm.blink.clone();
  const blinkMatR = sm.blink.clone();

  m.lightL.material = m.lightR.material = headLightMat;
  m.tailL.material = m.tailR.material = brakeLightMat;
  m.revL.material = m.revR.material = reverseLightMat;
  m.blinkFL.material = m.blinkRL.material = blinkMatL;
  m.blinkFR.material = m.blinkRR.material = blinkMatR;

  carMesh.userData.lights = { headLightMat, brakeLightMat, reverseLightMat, blinkMatL, blinkMatR };
}

function restoreStaticCarLights(carMesh) {
  if (!carMesh || !carMesh.userData || !carMesh.userData.lights) return;
  const sm = SharedAssets.carStaticMats;
  const m = carMesh.userData.lightMeshes;
  const old = carMesh.userData.lights;

  if (m) {
    m.lightL.material = m.lightR.material = sm.headLight;
    m.tailL.material = m.tailR.material = sm.brakeLight;
    m.revL.material = m.revR.material = sm.reverseLight;
    m.blinkFL.material = m.blinkRL.material = sm.blink;
    m.blinkFR.material = m.blinkRR.material = sm.blink;
  }

  Object.values(old).forEach(mat => mat.dispose());
  carMesh.userData.lights = null;
}

function addAssignedCarMarker(x, y, z, colors, rotationY = 0, targetGroup = parkingGroup) {
  if (carIndicatorMesh && carIndicatorMesh.parent) {
    carIndicatorMesh.parent.remove(carIndicatorMesh);
  }

  const markerGroup = new THREE.Group();
  const car = createDetailedPBRCarMesh(0, 0, 0, colors.accent, rotationY, false, false);
  markerGroup.add(car);

  const pinGeo = new THREE.ConeGeometry(0.32, 0.85, 8);
  const pinMat = new THREE.MeshStandardMaterial({
    color: colors.accent,
    roughness: 0.2,
    metalness: 0.6,
    emissive: colors.accent,
    emissiveIntensity: 0.25
  });
  const pin = new THREE.Mesh(pinGeo, pinMat);
  pin.rotation.x = Math.PI;
  pin.position.set(0, 2.2, 0);
  markerGroup.add(pin);
  markerGroup.userData.pin = pin;

  markerGroup.position.set(x, y, z);
  targetGroup.add(markerGroup);
  carIndicatorMesh = markerGroup;
}

/**
 * Ruta de navegación hacia #B-14 alineada con el sentido real de la rampa (Z = 11.0 pie -> Z = 1.0 cima)
 */
function buildNavigationInternalRoute(colors) {
  if (navigationPathLine && navigationPathLine.parent) {
    navigationPathLine.parent.remove(navigationPathLine);
    navigationPathLine = null;
  }

  if ((AppState.selectedBayLot || 1) !== 1) return;

  const centralGroup = lotGroups[1] || parkingGroup;
  const bx = CENTRAL_BLDG_X;
  const targetBay = bayMeshesMap[AppState.selectedBay];
  const targetLevel = targetBay ? targetBay.levelId : (AppState.selectedBayLevel || 'P1');
  const targetX = targetBay ? targetBay.x : (bx - 3.9);
  const targetY = targetBay ? targetBay.y + 0.06 : 4.45;
  const targetZ = targetBay ? targetBay.z : -8.25;
  const aisleX = targetBay ? targetBay.aisleX : (bx - 7.4);
  const zoneType = targetBay ? targetBay.zoneType : '';

  const pathPoints = [
    new THREE.Vector3(4.2, 0.22, -19.5),
    new THREE.Vector3(4.2, 0.22, -8.5)
  ];

  const pushBayFinish = (lvlY) => {
    if (zoneType === 'PB_OPEN_TOP') {
      pathPoints.push(new THREE.Vector3(targetX, lvlY, -8.5));
      pathPoints.push(new THREE.Vector3(targetX, targetY, targetZ));
    } else if (zoneType && zoneType.startsWith('PB_OPEN_')) {
      pathPoints.push(new THREE.Vector3(aisleX, lvlY, -8.5));
      pathPoints.push(new THREE.Vector3(aisleX, lvlY, targetZ));
      pathPoints.push(new THREE.Vector3(targetX, targetY, targetZ));
    } else if (aisleX > bx) {
      pathPoints.push(new THREE.Vector3(bx + 7.4, lvlY, targetZ));
      pathPoints.push(new THREE.Vector3(targetX, targetY, targetZ));
    } else {
      const crossZ = (targetZ < 0) ? -13.0 : 13.0;
      pathPoints.push(new THREE.Vector3(bx + 7.4, lvlY, crossZ));
      pathPoints.push(new THREE.Vector3(bx - 7.4, lvlY, crossZ));
      pathPoints.push(new THREE.Vector3(bx - 7.4, lvlY, targetZ));
      pathPoints.push(new THREE.Vector3(targetX, targetY, targetZ));
    }
  };

  if (targetLevel === 'PB') {
    if (!zoneType || !zoneType.startsWith('PB_OPEN_')) {
      pathPoints.push(new THREE.Vector3(bx + 7.4, 0.22, -8.5));
    }
    pushBayFinish(0.22);
  } else {
    // Subida por Rampa 1 (PB -> P1) centrada al ancho (Z=1.15) y orientada hacia Universidad (+X)
    pathPoints.push(
      new THREE.Vector3(bx + 7.4, 0.22, -8.5),
      new THREE.Vector3(bx + 7.4, 0.22, -13.0),
      new THREE.Vector3(bx - 7.4, 0.22, -13.0),
      new THREE.Vector3(bx - 7.4, 0.22, 1.15),
      new THREE.Vector3(bx - 5.0, 0.22, 1.15), // Pie de rampa PB
      new THREE.Vector3(bx + 5.0, 4.42, 1.15), // Cima de rampa Nivel 1 (hacia Universidad)
      new THREE.Vector3(bx + 7.4, 4.42, 1.15)
    );

    if (targetLevel === 'P1') {
      pushBayFinish(4.42);
    } else {
      // Subida por Rampa 2 (P1 -> P2) centrada al ancho (Z=1.15) y orientada hacia Universidad (+X)
      pathPoints.push(
        new THREE.Vector3(bx + 7.4, 4.42, 13.0),
        new THREE.Vector3(bx - 7.4, 4.42, 13.0),
        new THREE.Vector3(bx - 7.4, 4.42, 1.15),
        new THREE.Vector3(bx - 5.0, 4.42, 1.15), // Pie de rampa P1
        new THREE.Vector3(bx + 5.0, 8.62, 1.15), // Cima de rampa Nivel 2 (hacia Universidad)
        new THREE.Vector3(bx + 7.4, 8.62, 1.15)
      );
      pushBayFinish(8.62);
    }
  }

  const curve = new THREE.CatmullRomCurve3(pathPoints, false, 'centripetal', 0.22);
  const points = curve.getPoints(92);
  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({ color: colors.navPath, linewidth: 3 });

  navigationPathLine = new THREE.Line(lineGeo, lineMat);
  centralGroup.add(navigationPathLine);
}

/**
 * 3. SISTEMA CINEMÁTICO DE TRAYECTORIAS CON CURVAS BEZIER SIMÉTRICAS Y RAMPAS CORREGIDAS
 */
function buildRoundedSegmentsFromWaypoints(waypoints, gear = 'D', cornerRadius = 1.5) {
  const segments = [];
  if (waypoints.length < 2) return segments;

  const pts = waypoints.map(w => new THREE.Vector3(w.x, w.y, w.z));
  const numSegs = pts.length - 1;

  // Calcular radio de redondeo simétrico en cada vértice interior
  // En transiciones verticales de rampa (cambio en Y), usar un radio corto (0.36m) para que las ruedas sigan el plano exacto de la rampa
  const vertexCut = new Array(pts.length).fill(0);
  for (let v = 1; v < pts.length - 1; v++) {
    const prevP = pts[v - 1];
    const currP = pts[v];
    const nextP = pts[v + 1];
    const lenPrev = prevP.distanceTo(currP);
    const lenNext = currP.distanceTo(nextP);
    const isRampTransition = Math.abs(prevP.y - currP.y) > 0.2 || Math.abs(currP.y - nextP.y) > 0.2;
    const desiredRadius = isRampTransition ? 0.36 : cornerRadius;
    vertexCut[v] = Math.min(desiredRadius, lenPrev * 0.42, lenNext * 0.42);
  }

  const trimmed = [];
  for (let i = 0; i < numSegs; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    const dir = pB.clone().sub(pA).normalize();
    const sPt = pA.clone().addScaledVector(dir, vertexCut[i]);
    const ePt = pB.clone().addScaledVector(dir, -vertexCut[i + 1]);
    trimmed.push({ sPt, ePt, cornerPt: pB });
  }

  for (let i = 0; i < trimmed.length; i++) {
    const item = trimmed[i];
    const lineLen = item.sPt.distanceTo(item.ePt);
    if (lineLen > 0.03) {
      segments.push({
        kind: 'line',
        p0: item.sPt,
        p1: item.ePt,
        length: lineLen,
        gear,
        isParkingTurn: (i === trimmed.length - 1)
      });
    }

    if (i < trimmed.length - 1) {
      const nextItem = trimmed[i + 1];
      const c0 = item.ePt;
      const c1 = item.cornerPt;
      const c2 = nextItem.sPt;
      const approxLen = c0.distanceTo(c1) + c1.distanceTo(c2);
      if (approxLen > 0.03) {
        segments.push({
          kind: 'quad',
          p0: c0,
          p1: c1,
          p2: c2,
          length: approxLen * 0.92,
          gear,
          isParkingTurn: (i === trimmed.length - 2)
        });
      }
    }
  }

  return segments;
}

/**
 * Trayectorias de Entrada (Arrival):
 * - Rampa 1 (PB -> P1): entra por el pie sur (X = +1.15, Z = 11.0, Y = 0.64) y sube hacia el norte (X = +1.15, Z = 1.0, Y = 4.64).
 * - Rampa 2 (P1 -> P2): circula por P1 hasta el pie sur (X = +1.15, Z = 11.0, Y = 4.64) y sube hacia el norte (X = +1.15, Z = 1.0, Y = 8.84).
 */
function buildArrivalWaypoints(entry) {
  const bayY = entry.y + 0.45;
  const aisleX = entry.aisleX;
  const pts = [];

  if (entry.lotId === 2) {
    // Lienzo Charro: entra desde avenida horizontal (Norte, Z = -18.5 local)
    pts.push({ x: 0, y: bayY, z: -18.5 });
    pts.push({ x: 0, y: bayY, z: entry.z });
    pts.push({ x: entry.x, y: bayY, z: entry.z });
    return pts;
  }

  if (entry.lotId === 3) {
    // Interior Campus (Universidad): entra desde avenida horizontal (Sur, Z = +18.0 local)
    pts.push({ x: 0, y: bayY, z: 18.0 });
    pts.push({ x: 0, y: bayY, z: entry.z });
    pts.push({ x: entry.x, y: bayY, z: entry.z });
    return pts;
  }

  const bx = CENTRAL_BLDG_X;
  const yPB = 0.19 + 0.45; // 0.64
  const yP1 = 4.39 + 0.45; // 4.84
  const yP2 = 8.59 + 0.45; // 9.04

  if (entry.levelId === 'PB') {
    if (entry.zoneType === 'PB_OPEN_TOP') {
      pts.push({ x: 4.2, y: bayY, z: -19.5 });
      pts.push({ x: 4.2, y: bayY, z: -8.5 });
      pts.push({ x: entry.x, y: bayY, z: -8.5 });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    } else if (entry.zoneType && entry.zoneType.startsWith('PB_OPEN_')) {
      pts.push({ x: 4.2, y: bayY, z: -19.5 });
      pts.push({ x: 4.2, y: bayY, z: -8.5 });
      pts.push({ x: aisleX, y: bayY, z: -8.5 });
      pts.push({ x: aisleX, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    } else if (aisleX > bx) {
      pts.push({ x: 4.2, y: bayY, z: -19.5 });
      pts.push({ x: 4.2, y: bayY, z: -8.5 });
      pts.push({ x: bx + 7.4, y: bayY, z: -8.5 });
      pts.push({ x: bx + 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    } else {
      const crossZ = (entry.z < 0) ? -13.0 : 13.0;
      pts.push({ x: 4.2, y: bayY, z: -19.5 });
      pts.push({ x: 4.2, y: bayY, z: -8.5 });
      pts.push({ x: bx + 7.4, y: bayY, z: -8.5 });
      pts.push({ x: bx + 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    }
  } else if (entry.levelId === 'P1') {
    // Rampa 1 centrada (Z=1.15) y rotada hacia Universidad (+X)
    pts.push({ x: 4.2, y: yPB, z: -19.5 });
    pts.push({ x: 4.2, y: yPB, z: -8.5 });
    pts.push({ x: bx + 7.4, y: yPB, z: -8.5 });
    pts.push({ x: bx + 7.4, y: yPB, z: -13.0 });
    pts.push({ x: bx - 7.4, y: yPB, z: -13.0 });
    pts.push({ x: bx - 7.4, y: yPB, z: 1.15 });
    pts.push({ x: bx - 5.0, y: yPB, z: 1.15 });  // Pie Rampa 1 (PB)
    pts.push({ x: bx + 5.0, y: bayY, z: 1.15 }); // Cima Rampa 1 (P1, hacia Universidad)
    pts.push({ x: bx + 7.4, y: bayY, z: 1.15 });
    if (aisleX > bx) {
      pts.push({ x: bx + 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    } else {
      const crossZ = (entry.z < 0) ? -13.0 : 13.0;
      pts.push({ x: bx + 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    }
  } else {
    // Nivel 2 (P2): Rampa 1 (PB -> P1) -> Rampa 2 (P1 -> P2), ambas centradas (Z=1.15)
    pts.push({ x: 4.2, y: yPB, z: -19.5 });
    pts.push({ x: 4.2, y: yPB, z: -8.5 });
    pts.push({ x: bx + 7.4, y: yPB, z: -8.5 });
    pts.push({ x: bx + 7.4, y: yPB, z: -13.0 });
    pts.push({ x: bx - 7.4, y: yPB, z: -13.0 });
    pts.push({ x: bx - 7.4, y: yPB, z: 1.15 });
    pts.push({ x: bx - 5.0, y: yPB, z: 1.15 });  // Pie Rampa 1 (PB)
    pts.push({ x: bx + 5.0, y: yP1, z: 1.15 });  // Cima Rampa 1 (P1)
    pts.push({ x: bx + 7.4, y: yP1, z: 1.15 });
    pts.push({ x: bx + 7.4, y: yP1, z: 13.0 });
    pts.push({ x: bx - 7.4, y: yP1, z: 13.0 });
    pts.push({ x: bx - 7.4, y: yP1, z: 1.15 });
    pts.push({ x: bx - 5.0, y: yP1, z: 1.15 });  // Pie Rampa 2 (P1)
    pts.push({ x: bx + 5.0, y: yP2, z: 1.15 });  // Cima Rampa 2 (P2, hacia Universidad)
    pts.push({ x: bx + 7.4, y: bayY, z: 1.15 });
    if (aisleX > bx) {
      pts.push({ x: bx + 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    } else {
      const crossZ = (entry.z < 0) ? -13.0 : 13.0;
      pts.push({ x: bx + 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      pts.push({ x: bx - 7.4, y: bayY, z: entry.z });
      pts.push({ x: entry.x, y: bayY, z: entry.z });
    }
  }

  return pts;
}

/**
 * Trayectorias de Salida (Departure):
 * - Rampa 2 Bajada (P2 -> P1): entra por la cima norte (X = -1.15, Z = 1.0, Y = 9.04) y baja hacia el pie sur (X = -1.15, Z = 11.0, Y = 4.84).
 * - Rampa 1 Bajada (P1 -> PB): entra por la cima norte (X = -1.15, Z = 1.0, Y = 4.84) y baja hacia el pie sur (X = -1.15, Z = 11.0, Y = 0.64).
 */
function buildDeparturePhases(entry) {
  const bayY = entry.y + 0.45;
  const aisleX = entry.aisleX;
  const isPBOrSurface = (entry.lotId !== 1 || entry.levelId === 'PB');

  let reverseZOffset = (entry.lotId === 3) ? -1.75 : 1.75;
  if (!isPBOrSurface) {
    reverseZOffset = (entry.z < -0.5) ? -1.75 : 1.75;
  }
  const reverseEndZ = Math.max(-13.2, Math.min(12.2, entry.z + reverseZOffset));

  const pStart = new THREE.Vector3(entry.x, bayY, entry.z);
  const pCorner = new THREE.Vector3(aisleX, bayY, entry.z);
  const pReverseEnd = new THREE.Vector3(aisleX, bayY, reverseEndZ);

  const reverseSegment = {
    kind: 'quad',
    p0: pStart,
    p1: pCorner,
    p2: pReverseEnd,
    length: (pStart.distanceTo(pCorner) + pCorner.distanceTo(pReverseEnd)) * 0.92,
    gear: 'R',
    isParkingTurn: true
  };

  const pauseSegment = {
    kind: 'pause',
    pos: pReverseEnd.clone(),
    rotY: (reverseZOffset > 0) ? Math.PI : 0,
    duration: 0.22
  };

  const forwardPts = [{ x: pReverseEnd.x, y: bayY, z: pReverseEnd.z }];
  const bx = CENTRAL_BLDG_X;
  const yPB = 0.19 + 0.45; // 0.64
  const yP1 = 4.39 + 0.45; // 4.84

  if (entry.lotId === 2) {
    forwardPts.push({ x: 0, y: bayY, z: -18.5 });
  } else if (entry.lotId === 3) {
    forwardPts.push({ x: 0, y: bayY, z: 18.0 });
  } else if (entry.levelId === 'PB') {
    if (entry.zoneType === 'PB_OPEN_TOP') {
      forwardPts.push({ x: entry.x, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -19.5 });
    } else if (entry.zoneType && entry.zoneType.startsWith('PB_OPEN_')) {
      forwardPts.push({ x: aisleX, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -19.5 });
    } else if (aisleX > bx) {
      forwardPts.push({ x: bx + 7.4, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -19.5 });
    } else {
      const crossZ = (entry.z < 0) ? -13.0 : 13.0;
      forwardPts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      forwardPts.push({ x: bx + 7.4, y: bayY, z: crossZ });
      forwardPts.push({ x: bx + 7.4, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -8.5 });
      forwardPts.push({ x: 9.2, y: bayY, z: -19.5 });
    }
  } else if (entry.levelId === 'P1') {
    const crossZ = (entry.z < 0) ? -13.0 : 13.0;
    if (aisleX < bx) {
      forwardPts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      forwardPts.push({ x: bx + 7.4, y: bayY, z: crossZ });
    }
    forwardPts.push({ x: bx + 7.4, y: bayY, z: -1.15 });
    forwardPts.push({ x: bx + 5.0, y: bayY, z: -1.15 }); // Cima Rampa 1 (P1)
    forwardPts.push({ x: bx - 5.0, y: yPB, z: -1.15 });  // Pie Rampa 1 (PB)
    forwardPts.push({ x: bx - 7.4, y: yPB, z: -1.15 });
    forwardPts.push({ x: bx - 7.4, y: yPB, z: -13.0 });
    forwardPts.push({ x: bx + 7.4, y: yPB, z: -13.0 });
    forwardPts.push({ x: bx + 7.4, y: yPB, z: -8.5 });
    forwardPts.push({ x: 9.2, y: yPB, z: -8.5 });
    forwardPts.push({ x: 9.2, y: yPB, z: -19.5 });
  } else {
    const crossZ = (entry.z < 0) ? -13.0 : 13.0;
    if (aisleX < bx) {
      forwardPts.push({ x: bx - 7.4, y: bayY, z: crossZ });
      forwardPts.push({ x: bx + 7.4, y: bayY, z: crossZ });
    }
    forwardPts.push({ x: bx + 7.4, y: bayY, z: -1.15 });
    forwardPts.push({ x: bx + 5.0, y: bayY, z: -1.15 }); // Cima Rampa 2 (P2)
    forwardPts.push({ x: bx - 5.0, y: yP1, z: -1.15 });  // Pie Rampa 2 (P1)
    forwardPts.push({ x: bx - 7.4, y: yP1, z: -1.15 });
    forwardPts.push({ x: bx - 7.4, y: yP1, z: 13.0 });
    forwardPts.push({ x: bx + 7.4, y: yP1, z: 13.0 });
    forwardPts.push({ x: bx + 7.4, y: yP1, z: -1.15 });
    forwardPts.push({ x: bx + 5.0, y: yP1, z: -1.15 });  // Cima Rampa 1 (P1)
    forwardPts.push({ x: bx - 5.0, y: yPB, z: -1.15 });  // Pie Rampa 1 (PB)
    forwardPts.push({ x: bx - 7.4, y: yPB, z: -1.15 });
    forwardPts.push({ x: bx - 7.4, y: yPB, z: -13.0 });
    forwardPts.push({ x: bx + 7.4, y: yPB, z: -13.0 });
    forwardPts.push({ x: bx + 7.4, y: yPB, z: -8.5 });
    forwardPts.push({ x: 9.2, y: yPB, z: -8.5 });
    forwardPts.push({ x: 9.2, y: yPB, z: -19.5 });
  }

  const forwardSegments = buildRoundedSegmentsFromWaypoints(forwardPts, 'D', 1.35);
  return [reverseSegment, pauseSegment, ...forwardSegments];
}

function computeTotalSegmentsDistance(segments) {
  let total = 0;
  segments.forEach(s => {
    if (s.length) total += s.length;
  });
  return Math.max(10, total);
}

function animateCarArrival(entry, colors) {
  if (entry.data.isAnimating || entry.carMesh) return;
  entry.data.isAnimating = true;

  const isPB = (entry.levelId === 'PB');
  const carMesh = createDetailedPBRCarMesh(0, 0, 0, entry.data.carColor || colors.carOccupied, 0, (entry.lotId === 1 && !isPB), true);
  setCarMeshOpacity(carMesh, 1.0);
  const targetGroup = lotGroups[entry.lotId] || parkingGroup;
  targetGroup.add(carMesh);
  entry.carMesh = carMesh;

  const waypoints = buildArrivalWaypoints(entry);
  const segments = buildRoundedSegmentsFromWaypoints(waypoints, 'D', 1.35);
  const totalDist = computeTotalSegmentsDistance(segments);

  activeCarAnimations.push({
    mesh: carMesh,
    entry,
    type: 'arrival',
    segments,
    totalDist,
    currentSegIdx: 0,
    segDist: 0,
    pauseTimer: 0,
    baseSpeed: totalDist / Math.max(2.0, SimConfig.entryDurationSec),
    onComplete: () => {
      carMesh.position.set(entry.x, entry.y + 0.45, entry.z);
      carMesh.rotation.set(0, entry.carRotation, 0);
      resetVehicleLightsAndWheels(carMesh);
      restoreStaticCarLights(carMesh);
      if (!entry.isLevelActive) {
        setCarMeshOpacity(carMesh, 0.52);
      }
      entry.data.isAnimating = false;
      entry.bayMesh.material = SharedAssets.getBayMat(false, true, entry.isLevelActive);
    }
  });
}

function animateCarDeparture(entry, colors) {
  if (!entry.carMesh || entry.data.isAnimating) return;
  entry.data.isAnimating = true;

  const carMesh = entry.carMesh;
  ensureDynamicCarLights(carMesh);
  setCarMeshOpacity(carMesh, 1.0);
  entry.bayMesh.material = SharedAssets.getBayMat(false, false, entry.isLevelActive);

  const segments = buildDeparturePhases(entry);
  const totalDist = computeTotalSegmentsDistance(segments);

  activeCarAnimations.push({
    mesh: carMesh,
    entry,
    type: 'departure',
    segments,
    totalDist,
    currentSegIdx: 0,
    segDist: 0,
    pauseTimer: 0,
    baseSpeed: totalDist / Math.max(2.0, SimConfig.exitDurationSec),
    onComplete: () => {
      if (carMesh.parent) carMesh.parent.remove(carMesh);
      restoreStaticCarLights(carMesh);
      entry.carMesh = null;
      entry.data.isAnimating = false;
    }
  });
}

function resetVehicleLightsAndWheels(carMesh) {
  if (!carMesh || !carMesh.userData) return;
  const { bodyGroup, wheels, lights } = carMesh.userData;
  if (bodyGroup) bodyGroup.rotation.set(0, 0, 0);
  if (wheels) {
    wheels.forEach(w => {
      w.steerGroup.rotation.y = 0;
    });
  }
  if (lights) {
    lights.headLightMat.emissiveIntensity = 0.08;
    lights.brakeLightMat.emissiveIntensity = 0.08;
    lights.reverseLightMat.emissiveIntensity = 0.0;
    lights.blinkMatL.emissiveIntensity = 0.0;
    lights.blinkMatR.emissiveIntensity = 0.0;
  }
}

function evaluateSegmentAt(seg, t) {
  if (seg.kind === 'line') {
    _evalPos.lerpVectors(seg.p0, seg.p1, t);
    _evalTan.subVectors(seg.p1, seg.p0).normalize();
  } else if (seg.kind === 'quad') {
    const inv = 1 - t;
    _evalPos.x = inv * inv * seg.p0.x + 2 * inv * t * seg.p1.x + t * t * seg.p2.x;
    _evalPos.y = inv * inv * seg.p0.y + 2 * inv * t * seg.p1.y + t * t * seg.p2.y;
    _evalPos.z = inv * inv * seg.p0.z + 2 * inv * t * seg.p1.z + t * t * seg.p2.z;

    _evalTan.x = 2 * inv * (seg.p1.x - seg.p0.x) + 2 * t * (seg.p2.x - seg.p1.x);
    _evalTan.y = 2 * inv * (seg.p1.y - seg.p0.y) + 2 * t * (seg.p2.y - seg.p1.y);
    _evalTan.z = 2 * inv * (seg.p1.z - seg.p0.z) + 2 * t * (seg.p2.z - seg.p1.z);
    _evalTan.normalize();
  }

  return { pos: _evalPos, tangent: _evalTan };
}

function updateMultilevelCarAnimations(dt, elapsed) {
  const blinkOn = Math.sin(elapsed * 16.0) > 0;

  for (let i = activeCarAnimations.length - 1; i >= 0; i--) {
    const anim = activeCarAnimations[i];
    const segs = anim.segments;

    if (anim.currentSegIdx >= segs.length) {
      if (anim.onComplete) anim.onComplete();
      activeCarAnimations.splice(i, 1);
      continue;
    }

    const seg = segs[anim.currentSegIdx];
    const { bodyGroup, wheels, lights } = anim.mesh.userData || {};

    if (seg.kind === 'pause') {
      anim.pauseTimer += dt;
      anim.mesh.position.copy(seg.pos);
      if (lights) {
        lights.brakeLightMat.emissiveIntensity = 1.0;
        lights.reverseLightMat.emissiveIntensity = 0.0;
        lights.blinkMatL.emissiveIntensity = blinkOn ? 0.9 : 0.0;
        lights.blinkMatR.emissiveIntensity = blinkOn ? 0.9 : 0.0;
      }
      if (wheels) {
        wheels.forEach(w => { w.steerGroup.rotation.y *= 0.82; });
      }
      if (anim.pauseTimer >= seg.duration) {
        anim.currentSegIdx++;
        anim.segDist = 0;
        anim.pauseTimer = 0;
      }
      continue;
    }

    const isFirstSeg = (anim.currentSegIdx === 0);
    const isLastSeg = (anim.currentSegIdx === segs.length - 1);
    let speedMultiplier = 1.0;
    if (seg.gear === 'R') {
      speedMultiplier = 0.56;
    } else if (seg.kind === 'quad') {
      speedMultiplier = seg.isParkingTurn ? 0.54 : 0.78;
    } else if (isLastSeg && anim.type === 'arrival') {
      const remRatio = 1 - (anim.segDist / Math.max(0.1, seg.length));
      speedMultiplier = Math.max(0.24, Math.min(0.92, remRatio * remRatio * 0.76 + 0.24));
    } else if (isFirstSeg) {
      const accelRatio = Math.min(1, anim.segDist / 2.2);
      speedMultiplier = 0.48 + accelRatio * 0.52;
    }

    const stepDist = anim.baseSpeed * speedMultiplier * dt;
    anim.segDist += stepDist;

    if (anim.segDist >= seg.length) {
      const overshoot = anim.segDist - seg.length;
      anim.currentSegIdx++;
      anim.segDist = overshoot;
      if (anim.currentSegIdx >= segs.length) {
        if (anim.onComplete) anim.onComplete();
        activeCarAnimations.splice(i, 1);
        continue;
      }
    }

    const activeSeg = segs[anim.currentSegIdx];
    if (!activeSeg || activeSeg.kind === 'pause') continue;

    const t = Math.max(0, Math.min(1, anim.segDist / Math.max(0.05, activeSeg.length)));
    const { pos, tangent } = evaluateSegmentAt(activeSeg, t);

    anim.mesh.position.copy(pos);

    const gearSign = (activeSeg.gear === 'R') ? -1 : 1;
    const targetYaw = Math.atan2(tangent.x * gearSign, tangent.z * gearSign);

    const prevYaw = anim.mesh.rotation.y;
    let yawDiff = targetYaw - prevYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const yawDamp = 1 - Math.exp(-15 * dt);
    anim.mesh.rotation.y = prevYaw + yawDiff * yawDamp;

    const horizLen = Math.hypot(tangent.x, tangent.z);
    const rampPitch = -Math.atan2(tangent.y * gearSign, Math.max(0.001, horizLen));
    anim.mesh.rotation.x += (rampPitch - anim.mesh.rotation.x) * (1 - Math.exp(-12 * dt));

    const steerAngle = Math.max(-0.46, Math.min(0.46, yawDiff * 4.8 * gearSign));
    const bodyDamp = 1 - Math.exp(-10 * dt);
    if (bodyGroup) {
      const targetRoll = -steerAngle * 0.075 * gearSign;
      const isBraking = (activeSeg.isParkingTurn || (isLastSeg && anim.type === 'arrival' && t > 0.35));
      const targetBrakePitch = isBraking ? 0.022 : 0;
      bodyGroup.rotation.z += (targetRoll - bodyGroup.rotation.z) * bodyDamp;
      bodyGroup.rotation.x += (targetBrakePitch - bodyGroup.rotation.x) * bodyDamp;
    }

    if (wheels) {
      const wheelRadius = 0.23;
      const spinDelta = (stepDist / wheelRadius) * gearSign;
      const steerDamp = 1 - Math.exp(-14 * dt);
      for (let wIdx = 0; wIdx < wheels.length; wIdx++) {
        const w = wheels[wIdx];
        if (w.isFront) {
          w.steerGroup.rotation.y += (steerAngle - w.steerGroup.rotation.y) * steerDamp;
        }
        w.spinGroup.rotation.x += spinDelta;
      }
    }

    if (lights) {
      lights.headLightMat.emissiveIntensity = 0.65;
      const isSlowing = (activeSeg.kind === 'quad' || activeSeg.isParkingTurn || (isLastSeg && anim.type === 'arrival'));
      lights.brakeLightMat.emissiveIntensity = isSlowing ? 0.95 : 0.22;
      lights.reverseLightMat.emissiveIntensity = (activeSeg.gear === 'R') ? 1.0 : 0.0;

      if (activeSeg.kind === 'quad' || activeSeg.isParkingTurn) {
        const turningLeft = (yawDiff > 0.004);
        const turningRight = (yawDiff < -0.004);
        lights.blinkMatL.emissiveIntensity = (turningLeft && blinkOn) ? 1.0 : 0.0;
        lights.blinkMatR.emissiveIntensity = (turningRight && blinkOn) ? 1.0 : 0.0;
      } else {
        lights.blinkMatL.emissiveIntensity = 0.0;
        lights.blinkMatR.emissiveIntensity = 0.0;
      }
    }
  }
}

/**
 * 4. ALGORITMO INTELIGENTE DE SIMULACIÓN MULTINIVEL Y CONTROLES DE PARÁMETROS
 */
function restartSimulationLoop() {
  if (AppState.simulationTimer) clearInterval(AppState.simulationTimer);

  setTimeout(() => {
    if (AppState.simulationRunning) performSimulationStep();
  }, 800);

  AppState.simulationTimer = setInterval(() => {
    if (!AppState.simulationRunning) return;
    performSimulationStep();
  }, SimConfig.spawnIntervalMs);
}

/**
 * Selecciona inteligentemente una planta (PB, P1 o P2) rotando entre las 3 plantas
 * para garantizar flujo continuo hacia y desde Nivel 1 y Nivel 2.
 */
function pickSmartSimulationCandidate(forcedAction = null, forcedFloor = null) {
  let candidateSlots = [];

  if (forcedFloor && forcedFloor !== 'ALL') {
    candidateSlots.push({ lotId: 1, levelKey: forcedFloor });
  } else {
    // Rotación balanceada entre los 3 estacionamientos y las 3 plantas del Principal
    const rotation = [
      { lotId: 1, levelKey: 'P1' },
      { lotId: 2, levelKey: 'S' },
      { lotId: 1, levelKey: 'P2' },
      { lotId: 3, levelKey: 'S' },
      { lotId: 1, levelKey: 'PB' }
    ];
    const startIdx = AppState.levelRoundRobinIdx % rotation.length;
    AppState.levelRoundRobinIdx++;
    for (let i = 0; i < rotation.length; i++) {
      candidateSlots.push(rotation[(startIdx + i) % rotation.length]);
    }
  }

  const wantArrival = forcedAction
    ? (forcedAction === 'arrival')
    : (Math.random() < SimConfig.entryProbability);

  for (const slot of candidateSlots) {
    const floorInv = ParkingInventory[slot.lotId] && ParkingInventory[slot.lotId][slot.levelKey];
    if (!floorInv) continue;

    let matchingCodes = Object.keys(floorInv).filter(code => {
      const b = floorInv[code];
      if (code === AppState.selectedBay || b.isAnimating) return false;
      return wantArrival ? !b.occupied : (b.occupied && bayMeshesMap[code] && bayMeshesMap[code].carMesh);
    });

    if (matchingCodes.length === 0 && !forcedAction) {
      matchingCodes = Object.keys(floorInv).filter(code => {
        const b = floorInv[code];
        return code !== AppState.selectedBay && !b.isAnimating;
      });
    }

    if (matchingCodes.length > 0) {
      const chosenCode = matchingCodes[Math.floor(Math.random() * matchingCodes.length)];
      return { lotId: slot.lotId, levelKey: slot.levelKey, bayItem: floorInv[chosenCode] };
    }
  }

  return null;
}

function performSimulationStep(forcedAction = null, forcedFloor = null) {
  if (!forcedAction && activeCarAnimations.length >= SimConfig.maxConcurrentCars) return;

  const picked = pickSmartSimulationCandidate(forcedAction, forcedFloor);
  if (!picked) return;

  const { lotId, levelKey, bayItem } = picked;
  const randomCode = bayItem.code;
  bayItem.occupied = !bayItem.occupied;

  const colors = getPBRColors();
  const levelLabelMap = { 'PB': 'Planta Baja', 'P1': 'Nivel 1', 'P2': 'Nivel 2', 'S': LotsMetadata[lotId].shortName };
  const zoneTag = bayItem.isOpenAirPB ? 'PB Abierta' : (levelLabelMap[levelKey] || levelKey);
  const eventMsg = bayItem.occupied
    ? `Entrada hacia #${randomCode} (${zoneTag})`
    : `Salida desde #${randomCode} (${zoneTag})`;

  AppState.recentActivity = eventMsg;

  const entry = bayMeshesMap[randomCode];
  if (entry) {
    if (bayItem.occupied) {
      animateCarArrival(entry, colors);
    } else {
      animateCarDeparture(entry, colors);
    }
  }

  updateInventoryStatsUI();
  updateLiveFeedUI(eventMsg);
}

function setTrafficLevel(levelKey) {
  const preset = TRAFFIC_PRESETS[levelKey] || TRAFFIC_PRESETS.normal;
  SimConfig.trafficLevel = levelKey;
  SimConfig.spawnIntervalMs = preset.interval;
  SimConfig.maxConcurrentCars = preset.maxCars;

  const lbl = document.getElementById('lblTrafficLevel');
  if (lbl) lbl.innerText = preset.label;

  ['Low', 'Normal', 'High', 'Peak'].forEach(k => {
    const btn = document.getElementById(`btnTraffic${k}`);
    if (btn) btn.classList.toggle('active', k.toLowerCase() === levelKey);
  });

  restartSimulationLoop();
}

function updateSimTimings() {
  const rngEntry = document.getElementById('rngEntryTime');
  const rngExit = document.getElementById('rngExitTime');
  const lblEntry = document.getElementById('lblEntryTime');
  const lblExit = document.getElementById('lblExitTime');

  if (rngEntry) {
    SimConfig.entryDurationSec = parseFloat(rngEntry.value) || 5.5;
    if (lblEntry) lblEntry.innerText = `${SimConfig.entryDurationSec.toFixed(1)} s`;
  }
  if (rngExit) {
    SimConfig.exitDurationSec = parseFloat(rngExit.value) || 5.5;
    if (lblExit) lblExit.innerText = `${SimConfig.exitDurationSec.toFixed(1)} s`;
  }

  // Actualizar velocidad en vivo de los vehículos que ya están circulando
  activeCarAnimations.forEach(anim => {
    const dur = (anim.type === 'arrival') ? SimConfig.entryDurationSec : SimConfig.exitDurationSec;
    anim.baseSpeed = (anim.totalDist || 45) / Math.max(2.0, dur);
  });
}

function setFlowBias(biasKey) {
  SimConfig.flowBias = biasKey;
  const map = {
    entry:    { prob: 0.80, text: 'Priorizar Entrada (80/20)' },
    balanced: { prob: 0.50, text: 'Equilibrado (50/50)' },
    exit:     { prob: 0.20, text: 'Priorizar Salida (20/80)' }
  };
  const cfg = map[biasKey] || map.balanced;
  SimConfig.entryProbability = cfg.prob;

  const lbl = document.getElementById('lblFlowBias');
  if (lbl) lbl.innerText = cfg.text;

  ['Entry', 'Balanced', 'Exit'].forEach(k => {
    const btn = document.getElementById(`btnBias${k}`);
    if (btn) btn.classList.toggle('active', k.toLowerCase() === biasKey);
  });
}

function triggerManualVehicle(actionType) {
  const sel = document.getElementById('selTargetFloor');
  const targetFloor = sel ? sel.value : 'ALL';
  if (AppState.selectedLot !== 1 && targetFloor !== 'ALL') {
    selectLot(1);
  }
  performSimulationStep(actionType, targetFloor);
}

function toggleSimConfigPanel() {
  const panel = document.getElementById('simConfigPanel');
  const btn = document.getElementById('btnSimParams');
  if (!panel) return;
  const isShowing = panel.classList.toggle('show');
  if (btn) btn.classList.toggle('active', isShowing);
  if (isShowing && AppState.mode === 'mobile') {
    setMobileSheetState('collapsed');
    closeMobileCredential();
  }
}

function closeSimConfigPanel() {
  const panel = document.getElementById('simConfigPanel');
  const btn = document.getElementById('btnSimParams');
  if (panel) panel.classList.remove('show');
  if (btn) btn.classList.remove('active');
}

function toggleSimulation() {
  AppState.simulationRunning = !AppState.simulationRunning;
  const btn = document.getElementById('btnToggleSim');
  const mobileBtn = document.getElementById('btnMobileToggleSim');
  const dot = document.getElementById('simDot');

  if (btn) {
    btn.textContent = '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', AppState.simulationRunning ? 'pause' : 'play');
    icon.style.width = '12px';
    icon.style.height = '12px';
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(AppState.simulationRunning ? ' Pausar' : ' Reanudar'));
  }
  if (mobileBtn) {
    mobileBtn.textContent = AppState.simulationRunning ? 'Pausar' : 'Reanudar';
  }
  if (dot) {
    dot.classList.toggle('paused', !AppState.simulationRunning);
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * NAVEGACIÓN Y GESTOS EN INTERFAZ MÓVIL DE BAJA CARGA COGNITIVA
 */
function setMobileSheetState(state) {
  const sidebar = document.querySelector('.sidebar');
  const chevron = document.getElementById('mobileSheetChevron');
  if (!sidebar) return;
  sidebar.classList.remove('sheet-expanded', 'sheet-collapsed');
  if (state === 'expanded') sidebar.classList.add('sheet-expanded');
  else if (state === 'collapsed') sidebar.classList.add('sheet-collapsed');
  AppState.mobileSheetState = state;

  if (chevron) {
    chevron.style.transform = (state === 'expanded') ? 'rotate(180deg)' : 'rotate(0deg)';
  }
}

function toggleMobileSheet() {
  if (AppState.mode !== 'mobile') return;
  closeSimConfigPanel();
  closeMobileCredential();
  if (AppState.mobileSheetState === 'collapsed') {
    setMobileSheetState('expanded');
  } else {
    setMobileSheetState('collapsed');
  }
}

function setupMobileSheetTouch() {
  const header = document.querySelector('.sidebar-header');
  if (!header) return;

  let startY = 0;
  header.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) startY = e.touches[0].clientY;
  }, { passive: true });

  header.addEventListener('touchend', (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dy) < 22) return;
    if (dy < -22) {
      closeSimConfigPanel();
      closeMobileCredential();
      setMobileSheetState('expanded');
    } else if (dy > 22) {
      setMobileSheetState('collapsed');
    }
  }, { passive: true });
}

function closeMobileCredential() {
  const card = document.getElementById('mobileCredentialCard');
  if (card) card.classList.remove('show');
}

function syncMobileQuickLevelButtons() {
  const quickBar = document.getElementById('mobileQuickLevels');
  if (quickBar) {
    const showLevels = (AppState.selectedLot === 1 && AppState.mode === 'mobile' && AppState.cameraMode !== 'overview');
    quickBar.style.display = showLevels ? 'inline-flex' : 'none';
  }
  ['PB', 'P1', 'P2'].forEach(lvl => {
    const btn = document.getElementById(`mTab${lvl}`);
    if (btn) btn.classList.toggle('active', AppState.selectedLevel === lvl);
  });
}

function handleMobileTab(tabName) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  const credCard = document.getElementById('mobileCredentialCard');
  const simPanel = document.getElementById('simConfigPanel');

  if (tabName === '3d') {
    const t3d = document.getElementById('tabItem3D');
    if (t3d) t3d.classList.add('active');
    if (credCard) credCard.classList.remove('show');
    if (simPanel) simPanel.classList.remove('show');
    setCameraIsometric();
  } else if (tabName === 'sim') {
    const tSim = document.getElementById('tabItemSim');
    if (tSim) tSim.classList.add('active');
    if (credCard) credCard.classList.remove('show');
    if (simPanel) simPanel.classList.toggle('show');
  } else if (tabName === 'user') {
    const tUser = document.getElementById('tabItemUser');
    if (tUser) tUser.classList.add('active');
    if (simPanel) simPanel.classList.remove('show');
    if (credCard) credCard.classList.toggle('show');
  }
}

/**
 * ACTUALIZACIÓN DE INTERFAZ Y ESTADÍSTICAS
 */
function updateInventoryStatsUI() {
  const lot1Inventory = ParkingInventory[1];
  let lot1Free = 0;
  let lot1Total = 0;
  Object.values(lot1Inventory).forEach(lvl => {
    const arr = Object.values(lvl);
    lot1Total += arr.length;
    arr.forEach(b => { if (!b.occupied) lot1Free++; });
  });

  let lot2Free = 0;
  Object.values(ParkingInventory[2]['S']).forEach(b => { if (!b.occupied) lot2Free++; });

  let lot3Free = 0;
  Object.values(ParkingInventory[3]['S']).forEach(b => { if (!b.occupied) lot3Free++; });

  const stat1 = document.getElementById('statLot1Free');
  const cap1 = document.getElementById('statLot1Cap');
  const stat2 = document.getElementById('statLot2Free');
  const stat3 = document.getElementById('statLot3Free');
  if (stat1) stat1.innerText = `${lot1Free} plazas`;
  if (cap1) cap1.innerText = `${lot1Total}`;
  if (stat2) stat2.innerText = `${lot2Free} plazas`;
  if (stat3) stat3.innerText = `${lot3Free} plazas`;

  const rLot1 = document.getElementById('rLotCount1');
  const rLot2 = document.getElementById('rLotCount2');
  const rLot3 = document.getElementById('rLotCount3');
  if (rLot1) rLot1.innerText = `${lot1Free}`;
  if (rLot2) rLot2.innerText = `${lot2Free}`;
  if (rLot3) rLot3.innerText = `${lot3Free}`;

  const pbFree = Object.values(lot1Inventory['PB']).filter(b => !b.occupied).length;
  const p1Free = Object.values(lot1Inventory['P1']).filter(b => !b.occupied).length;
  const p2Free = Object.values(lot1Inventory['P2']).filter(b => !b.occupied).length;

  const btnPB = document.getElementById('tabPB');
  const btnP1 = document.getElementById('tabP1');
  const btnP2 = document.getElementById('tabP2');
  if (btnPB) btnPB.innerText = `PB (${pbFree})`;
  if (btnP1) btnP1.innerText = `Nivel 1 (${p1Free})`;
  if (btnP2) btnP2.innerText = `Nivel 2 (${p2Free})`;

  // Actualizar resumen compacto del Bottom Sheet en móvil
  const peekSummary = document.getElementById('mobilePeekSummary');
  if (peekSummary) {
    const activeFree = AppState.selectedLot === 1 ? lot1Free : (AppState.selectedLot === 2 ? lot2Free : lot3Free);
    const shortName = LotsMetadata[AppState.selectedLot].shortName;
    peekSummary.innerText = `${shortName} • ${activeFree} libres`;
  }

  syncMobileQuickLevelButtons();
  refresh2DBayGrid();
}

function updateLiveFeedUI(msg) {
  const ticker = document.getElementById('simFeedText');
  if (ticker) ticker.innerText = msg;
}

function refresh2DBayGrid() {
  const grid = document.getElementById('bayGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const currentLotId = AppState.selectedLot;
  const currentLevelKey = LotsMetadata[currentLotId].hasLevels ? AppState.selectedLevel : 'S';
  const inventory = ParkingInventory[currentLotId][currentLevelKey] || {};
  const keys = Object.keys(inventory);
  const freeCount = keys.filter(k => !inventory[k].occupied).length;

  const subtitle = document.getElementById('bayInspectSubtitle');
  if (subtitle) {
    if (currentLotId === 1 && currentLevelKey === 'PB') {
      subtitle.innerText = `PB (42 Cubiertos + 32 Abiertos s/sombra) • ${freeCount} Libres`;
    } else if (currentLotId === 1) {
      const lvlName = currentLevelKey === 'P1' ? 'Nivel 1' : 'Nivel 2';
      subtitle.innerText = `${lvlName} (${keys.length} Cajones) • ${freeCount} Libres`;
    } else {
      subtitle.innerText = `Superficie (${keys.length} Cajones) • ${freeCount} Libres`;
    }
  }

  const blockedSet = AppState.reservation && AppState.reservation.expiredBlockedBays;
  keys.forEach(code => {
    const item = inventory[code];
    const isSelected = AppState.selectedBay === code;
    const isOccupied = item.occupied && !isSelected;
    const isExpiredBlocked = blockedSet && blockedSet.has(code);

    const slot = document.createElement('div');
    slot.className = `bay-cell ${isSelected ? 'active-selection' : (isOccupied ? 'taken' : (isExpiredBlocked ? 'expired-blocked' : 'free'))} ${item.isOpenAirPB ? 'open-air-bay' : ''}`;
    slot.title = isExpiredBlocked
      ? `${code} • Tiempo expirado: debes seleccionar otro cajón`
      : (item.isOpenAirPB ? `${code} • Planta Baja Abierta (Con árboles, sin sombra artificial)` : code);
    slot.innerText = code;
    slot.onclick = () => {
      if (code === AppState.selectedBay) {
        setCameraBay();
      } else if (isExpiredBlocked) {
        showRestrictionAlert(code, 'expired_blocked');
      } else if (!item.occupied && !item.isAnimating) {
        requestBaySelection(code, currentLotId, currentLevelKey, getSelectedArrivalWindow());
      } else {
        showRestrictionAlert(code, 'occupied');
      }
    };
    grid.appendChild(slot);
  });
}

function setTheme(theme) {
  AppState.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  const btnLight = document.getElementById('btn-theme-light');
  const btnDark = document.getElementById('btn-theme-dark');
  if (btnLight) btnLight.classList.toggle('active', theme === 'light');
  if (btnDark) btnDark.classList.toggle('active', theme === 'dark');

  const mobileThemeBtn = document.getElementById('btnMobileTheme');
  if (mobileThemeBtn) {
    mobileThemeBtn.textContent = '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    icon.style.width = '13px';
    icon.style.height = '13px';
    mobileThemeBtn.appendChild(icon);
    if (window.lucide) lucide.createIcons();
  }

  if (scene) {
    const colors = getPBRColors();
    scene.background = new THREE.Color(colors.bg);
    if (scene.fog) scene.fog.color = new THREE.Color(colors.bg);
    rebuildParking3D();
  }
}

function toggleTheme() {
  setTheme(AppState.theme === 'dark' ? 'light' : 'dark');
}

function syncResponsiveMode(fromResize = false) {
  const nextMode = window.innerWidth <= 860 ? 'mobile' : 'web';
  if (fromResize && AppState.mode === nextMode) return;
  setView(nextMode, fromResize);
}

function setView(mode, skipResize = false) {
  AppState.mode = mode;
  const frame = document.getElementById('appFrame');
  if (!frame) return;

  if (mode === 'mobile') {
    frame.classList.add('mode-mobile');
    setMobileSheetState('collapsed');
  } else {
    frame.classList.remove('mode-mobile');
    closeMobileCredential();
    closeMobileRadialMenu();
  }

  syncMobileQuickLevelButtons();
  if (!skipResize) {
    setCameraIsometric();
    setTimeout(onWindowResize, 60);
  }
}

function selectLot(lotId) {
  AppState.selectedLot = lotId;
  const meta = LotsMetadata[lotId];

  for (let i = 1; i <= 3; i++) {
    const card = document.getElementById(`card-lot-${i}`);
    if (card) card.classList.toggle('active', i === lotId);
  }

  const hudTitle = document.getElementById('hudLotTitle');
  if (hudTitle) hudTitle.innerText = meta.name;

  if (AppState.mode === 'mobile') {
    setMobileSheetState('collapsed');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    const tab3d = document.getElementById('tabItem3D');
    if (tab3d) tab3d.classList.add('active');
  }

  updateInventoryStatsUI();
  setCameraIsometric();
}

function selectLevel(btn, levelCode) {
  AppState.selectedLevel = levelCode;
  document.querySelectorAll('.level-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const names = { 'PB': 'Planta Baja', 'P1': 'Nivel 1', 'P2': 'Nivel 2' };
  const lvlTxt = document.getElementById('selectedLevelText');
  if (lvlTxt) lvlTxt.innerText = names[levelCode] || levelCode;

  syncMobileQuickLevelButtons();
  updateCentralLevelsVisualState();
  updateInventoryStatsUI();
  if (AppState.cameraMode !== 'bay' && AppState.cameraMode !== 'overview') {
    setCameraIsometric();
  }
}

function toggleRole() {
  AppState.isDocente = !AppState.isDocente;
  const badge = document.querySelector('.role-badge span');
  const btnLabel = document.getElementById('roleLabel');
  const mobileCredRole = document.getElementById('mobileCredRole');

  if (AppState.isDocente) {
    if (badge) badge.innerText = 'Personal Docente / Administrativo';
    if (btnLabel) btnLabel.innerText = 'Ver como: Estudiante';
    if (mobileCredRole) mobileCredRole.innerText = 'Personal Docente / Administrativo';
  } else {
    if (badge) badge.innerText = 'Estudiante Matrícula Activa';
    if (btnLabel) btnLabel.innerText = 'Ver como: Docente';
    if (mobileCredRole) mobileCredRole.innerText = 'Estudiante Matrícula Activa';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  syncResponsiveMode(true);
  initThreeJS();
  syncAssignedBayUI();
  syncReservationUI();
});
