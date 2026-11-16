# UniPark — Wireframe 3D y Navegación de Estacionamiento Campus

Aplicación web y móvil interactiva para localización, asignación y navegación interna de cajones de estacionamiento en una institución educativa.

## Arquitectura de Archivos
- **[index.html](file:///c:/Users/levia/Desktop/VT/ParkFinder/index.html):** Estructura semántica unificada con política CSP estricta (`connect-src 'none'`), controles de simulación y contenedor del canvas WebGL Three.js.
- **[styles.css](file:///c:/Users/levia/Desktop/VT/ParkFinder/styles.css):** Hoja de estilos con enfoque **Glassmorphism minimalista** y diseño **100% adaptable (Responsive)** que ajusta automáticamente la interfaz a escritorio, tablet y móvil.
- **[app.js](file:///c:/Users/levia/Desktop/VT/ParkFinder/app.js):** Lógica funcional de la aplicación, detección automática de formato de dispositivo y motor de renderizado 3D con **Three.js**.
- **vendor/:** Librerías locales (`three.min.js` y `lucide.min.js`) sin CDNs externos ni rastreadores.

## Seguridad y Privacidad
- **Cero API Keys y cero rastreadores:** Toda la simulación, cálculo de rutas y geolocalización opcional (Haversine local) se ejecuta 100% en el navegador.
- **Sin dependencias externas en tiempo de ejecución:** Se eliminaron Google Fonts y CDNs remotos; incluye `Content-Security-Policy` restrictiva y `referrer: no-referrer`.

## Contexto Institucional Modelado
1. **Estacionamiento Central Principal (Oficial Multinivel):**
   - Maquetado 3D de **3 plantas** (Planta Baja y 2 niveles apilados).
   - Incluye losas estructurales con transparencia arquitectónica, rampas de conexión, columnas y un conmutador de niveles (`PB`, `Nivel 1`, `Nivel 2`).
2. **Estacionamiento Lienzo Charro (Convenio Externo):**
   - Instalación en superficie abierta prestada a la universidad (a 250 m del campus).
3. **Estacionamiento Interior Campus (Docentes / Administrativos & Desahogo):**
   - Prioridad de acceso para personal con credencial universitaria.
   - Integra la lógica del **Protocolo de Desahogo** cuando los otros 2 estacionamientos están saturados.

## Navegación Interna en 3D
- Trazo de vector azul continuo desde el acceso vehicular hasta la bahía asignada.
- Modelo wireframe del vehículo/pin indicador sobre el cajón seleccionado.
- Controles de cámara integrados: Isométrica, Cenital (plano de planta) y Enfoque guiado en el cajón (`Iniciar Navegación 3D`).
- Soporte de interacción táctil / mouse: rotar con click sostenido y zoom con la rueda.
