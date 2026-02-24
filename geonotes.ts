import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { parse as parseYaml } from "@std/yaml";

/** A page with parsed geographic coordinates. */
interface GeoPage {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Parses the `center` field from widget config.
 * Handles three formats:
 * - `"lat, lng"` string with coordinates
 * - `[lat, lng]` YAML array
 * - `"Place Name"` string for geocoding via Nominatim
 *
 * @param raw - The raw `center` value from parsed YAML
 * @returns Parsed center as coords or place name, or null if absent/invalid
 */
function parseCenter(
  raw: unknown,
): { type: "coords"; lat: number; lng: number } | { type: "name"; name: string } | null {
  if (typeof raw === "string") {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (isFinite(lat) && isFinite(lng)) return { type: "coords", lat, lng };
    }
    return { type: "name", name: raw };
  }
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = Number(raw[0]);
    const lng = Number(raw[1]);
    if (isFinite(lat) && isFinite(lng)) return { type: "coords", lat, lng };
  }
  return null;
}

/**
 * Parses a `location` value from page frontmatter.
 * Handles `[lat, lng]` arrays and `{lat, lng}` objects.
 *
 * @param loc - The raw `location` value from page frontmatter
 * @returns Parsed lat/lng, or null if invalid
 */
function parseLocation(loc: unknown): { lat: number; lng: number } | null {
  if (Array.isArray(loc) && loc.length >= 2) {
    const lat = Number(loc[0]), lng = Number(loc[1]);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  if (loc && typeof loc === "object") {
    const obj = loc as Record<string, unknown>;
    const lat = Number(obj.lat), lng = Number(obj.lng);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  return null;
}

/**
 * Queries the SilverBullet index for all pages with a `location` frontmatter field
 * and returns them as parsed GeoPage objects.
 *
 * @returns Array of pages with valid geographic coordinates
 */
async function queryGeoPages(): Promise<GeoPage[]> {
  const results = await system.invokeFunction("index.queryLuaObjects", "page", {}) as any[];
  const geoPages: GeoPage[] = [];
  for (const p of results) {
    const loc = parseLocation(p.location);
    if (loc) geoPages.push({ name: p.name, lat: loc.lat, lng: loc.lng });
  }
  return geoPages;
}

/** Available map tile styles. */
const TILES: Record<string, { url: string; attribution: string; maxZoom: number }> = {
  osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 },
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 20 },
  light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 20 },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors &copy; OpenTopoMap", maxZoom: 17 },
};

/**
 * SilverBullet code widget handler for ```map fences.
 * Renders an interactive Leaflet map with configurable center, zoom, style, and markers.
 *
 * Supported YAML config inside the fence:
 * - `center` — Place name (`"Paris"`) or coordinates (`"48.85, 2.35"` / `[48.85, 2.35]`)
 * - `zoom` — Zoom level (default: 13 with center, 2 without)
 * - `height` — Widget height in pixels (default: 400)
 * - `style` — Tile style: `osm`, `dark`, `light`, `topo` (default: `osm`)
 * - `zoomControl` — Show zoom buttons (default: true)
 *
 * @param bodyText - Raw YAML string from inside the code fence
 * @param _pageName - Name of the page containing the widget
 * @returns Widget content with HTML, script, and height
 */
export async function mapWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string; height: number }> {
  let centerInfo: ReturnType<typeof parseCenter> = null;
  let zoom = 13;
  let height = 400;
  let zoomControl = true;
  let style = "osm";

  if (bodyText.trim()) {
    try {
      const parsed = parseYaml(bodyText) as Record<string, unknown>;
      centerInfo = parseCenter(parsed.center);
      if (typeof parsed.zoom === "number") zoom = parsed.zoom;
      if (typeof parsed.height === "number") height = parsed.height;
      if (typeof parsed.zoomControl === "boolean") zoomControl = parsed.zoomControl;
      if (typeof parsed.style === "string") style = parsed.style;
    } catch { /* use defaults */ }
  }

  const tile = TILES[style] ?? TILES.osm;

  // Build the setView call depending on center type
  let initView: string;
  if (centerInfo?.type === "coords") {
    initView = `map.setView([${centerInfo.lat},${centerInfo.lng}],${zoom});`;
  } else if (centerInfo?.type === "name") {
    initView = `
      fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(${JSON.stringify(centerInfo.name)}))
        .then(function(r){return r.json()})
        .then(function(data){
          if(data.length>0){
            map.setView([parseFloat(data[0].lat),parseFloat(data[0].lon)],${zoom});
          }
        });
    `;
  } else {
    initView = `map.setView([0,0],2);`;
  }

  // Query pages with location frontmatter
  let geoPages: GeoPage[] = [];
  let debugError = "";
  try {
    geoPages = await queryGeoPages();
  } catch (e) {
    debugError = String(e);
  }

  return {
    html: `<style>body,html{margin:0;padding:0;}#map{width:100%;height:${height}px;}#debug{padding:8px;font-family:monospace;font-size:12px;white-space:pre;background:#1e1e1e;color:#d4d4d4;overflow:auto;max-height:300px;}</style><div id="map"></div><div id="debug">geo pages (${geoPages.length}): ${JSON.stringify(geoPages, null, 2).replace(/</g, '&lt;')}${debugError ? '\nerror: ' + debugError : ''}</div>`,
    script: `
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      var s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function() {
        var map = L.map('map',{zoomControl:${zoomControl}});
        L.tileLayer(${JSON.stringify(tile.url)}, {
          attribution: ${JSON.stringify(tile.attribution)},
          maxZoom: ${tile.maxZoom}
        }).addTo(map);
        ${initView}
      };
      s.onerror = function() {
        document.getElementById('map').textContent = 'Failed to load Leaflet';
      };
      document.head.appendChild(s);
    `,
    height,
  };
}
