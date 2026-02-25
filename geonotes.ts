/**
 * █▀ █ █░░ █░█ █▀▀ █▀█ █▄▄ █░█ █░░ █░░ █▀▀ ▀█▀   █▀▄▀█ ▄▀█ █▀█   █░█ █ █▀▀ █░█░█
 * ▄█ █ █▄▄ ▀▄▀ ██▄ █▀▄ █▄█ █▄█ █▄▄ █▄▄ ██▄ ░█░   █░▀░█ █▀█ █▀▀   ▀▄▀ █ ██▄ ▀▄▀▄▀
 *
 * Like Obsidian Map View, but for Silverbullet!
 *
 * Full credit to esm7 for their awesome work. This is essentially just porting it to 
 * a different platform, with some little changes. https://github.com/esm7/obsidian-map-view
 */

/********************************************************************************
 * Imports
 ********************************************************************************/

import { asset, editor, index, space, system } from "@silverbulletmd/silverbullet/syscalls";
import { parse as parseYaml } from "@std/yaml";

/********************************************************************************
 * Constants
 ********************************************************************************/

/** Available map tile styles. */
const TILES: Record<string, { url: string; attribution: string; maxZoom: number }> = {
  osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 },
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", maxZoom: 20 },
  light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", maxZoom: 20 },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", maxZoom: 17 },
};


/********************************************************************************
 * Types and interfaces
 ********************************************************************************/

/** A page with parsed geographic coordinates. */
interface GeoPage {
  name: string;
  lat: number;
  lng: number;
}

/** An indexed geolink extracted from page content. */
interface GeoLink {
  ref: string;
  tag: string;
  page: string;
  name: string;
  lat: number;
  lng: number;
}

/** A unified geo item from either a geopage or geolink source. */
interface GeoItem {
  type: "page" | "link";
  /** Display name: page name for geonotes, link label for geolinks. */
  name: string;
  /** Page containing this item (same as name for geonotes). */
  page: string;
  lat: number;
  lng: number;
}

/** Marker appearance config from the CONFIG `geonote.markers` array. */
interface MarkerConfig {
  icon?: string;        // Phosphor icon name, e.g. "map-pin"
  markerColor?: string; // CSS color for the shape background
  iconColor?: string;   // CSS color for the icon (default: white)
  shape?: "pin" | "circle" | "square" | "diamond"; // default: "pin"
  opacity?: number;     // 0–1
}

/**
 * Query filters for geo items. All string values are JavaScript regex patterns.
 * Multiple filters are ANDed together.
 */
interface GeoQuery {
  /** Show items whose containing page is wiki-linked from pages matching this pattern. */
  linkedFrom?: string;
  /** Show items whose containing page has a wiki link to pages matching this pattern. */
  linkedTo?: string;
  /** Show items whose containing page path matches this pattern. */
  path?: string;
  /** Show items whose display name matches this pattern (page name or geolink label). */
  name?: string;
}


/********************************************************************************
 * Functions
 ********************************************************************************/

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
 * Compiles a pattern string into a RegExp.
 * Bare `*` is treated as a glob wildcard (converted to `.*`);
 * `*` already preceded by `.` is left alone so proper regex still works.
 *
 * @param pattern - Glob-style or regex pattern string
 * @returns Compiled RegExp
 */
function makeRegex(pattern: string): RegExp {
  const converted = pattern.replace(/\*/g, (m, offset, str) =>
    offset > 0 && str[offset - 1] === "." ? m : ".*"
  );
  return new RegExp(converted);
}

/**
 * Extracts wiki link targets from page content.
 * Handles `[[Page]]`, `[[Page|alias]]`, and `[[Page#section]]` formats.
 *
 * @param text - Raw page content
 * @returns Array of linked page names (unaliased, without anchors)
 */
function extractWikiLinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}

/**
 * Reads geonotes configuration from the SilverBullet CONFIG page.
 * Users can configure via `config.set { geonote = { ... } }` in CONFIG.
 *
 * @returns Parsed geonotes config with defaults applied
 */
async function getConfig(): Promise<{ frontMatterLocationKey: string; marker: MarkerConfig }> {
  const raw = await system.getConfig("geonote", {}) as Record<string, unknown>;
  let marker: MarkerConfig = {};
  if (Array.isArray(raw.markers) && raw.markers.length > 0) {
    const m = raw.markers[0] as Record<string, unknown>;
    marker = {
      icon: typeof m.icon === "string" ? m.icon : undefined,
      markerColor: typeof m.markerColor === "string" ? m.markerColor : undefined,
      iconColor: typeof m.iconColor === "string" ? m.iconColor : undefined,
      shape: typeof m.shape === "string" ? m.shape as MarkerConfig["shape"] : undefined,
      opacity: typeof m.opacity === "number" ? m.opacity : undefined,
    };
  }
  return {
    frontMatterLocationKey: typeof raw.frontMatterLocationKey === "string"
      ? raw.frontMatterLocationKey
      : "location",
    marker,
  };
}

/**
 * Queries the SilverBullet index for all pages with a location frontmatter field
 * and returns them as parsed GeoPage objects.
 *
 * @param locationKey - The frontmatter key to look for (from config, default: "location")
 * @returns Array of pages with valid geographic coordinates
 */
async function queryGeoPages(locationKey: string): Promise<GeoPage[]> {
  const results = await system.invokeFunction("index.queryLuaObjects", "page", {}) as any[];
  const geoPages: GeoPage[] = [];
  for (const p of results) {
    const loc = parseLocation(p[locationKey]);
    if (loc) geoPages.push({ name: p.name, lat: loc.lat, lng: loc.lng });
  }
  return geoPages;
}

/**
 * Applies query filters to a list of unified geo items.
 * All filter patterns are treated as JavaScript regular expressions.
 * Multiple filters are ANDed together (all must match).
 *
 * - `path` — regex tested against the containing page path
 * - `name` — regex tested against the display name (page name or geolink label)
 * - `linkedFrom` — keeps items whose page is wiki-linked from pages matching the pattern
 * - `linkedTo` — keeps items whose page wiki-links to pages matching the pattern
 *
 * @param items - Unified geo items to filter
 * @param query - Query filter config
 * @returns Filtered geo items
 */
async function applyQuery(items: GeoItem[], query: GeoQuery): Promise<GeoItem[]> {
  let result = items;

  if (query.path) {
    const re = makeRegex(query.path);
    result = result.filter((i) => re.test(i.page));
  }

  if (query.name) {
    const re = makeRegex(query.name);
    result = result.filter((i) => re.test(i.name));
  }

  if (query.linkedFrom) {
    const sourceRe = makeRegex(query.linkedFrom);
    // Find all pages whose name matches the pattern
    const allPages = await system.invokeFunction("index.queryLuaObjects", "page", {}) as any[];
    const sourcePageNames = (allPages as any[])
      .map((p) => p.name as string)
      .filter((n) => sourceRe.test(n));
    // Read each source page and collect all wiki links from them
    const linkedPageNames = new Set<string>();
    for (const sourceName of sourcePageNames) {
      try {
        const { text } = await space.readPage(sourceName);
        for (const link of extractWikiLinks(text)) {
          linkedPageNames.add(link);
        }
      } catch { /* skip unreadable pages */ }
    }
    result = result.filter((i) => linkedPageNames.has(i.page));
  }

  if (query.linkedTo) {
    const targetRe = makeRegex(query.linkedTo);
    const allPages = await system.invokeFunction("index.queryLuaObjects", "page", {}) as any[];
    const targetPageNames = new Set<string>(
      (allPages as any[]).map((p) => p.name as string).filter((n) => targetRe.test(n)),
    );
    // For each unique geo page, check if it wiki-links to a target page
    const uniqueGeoPageNames = [...new Set(result.map((i) => i.page))];
    const geoPagesThatLinkToTarget = new Set<string>();
    for (const geoPageName of uniqueGeoPageNames) {
      try {
        const { text } = await space.readPage(geoPageName);
        if (extractWikiLinks(text).some((l) => targetPageNames.has(l))) {
          geoPagesThatLinkToTarget.add(geoPageName);
        }
      } catch { /* skip unreadable pages */ }
    }
    result = result.filter((i) => geoPagesThatLinkToTarget.has(i.page));
  }

  return result;
}

/**
 * Click handler for geolinks. Navigates to the SilverBullet page named after
 * the link label for any `[label](geo:...)` link, regardless of coordinates.
 */
export async function geoLinkClick(
  { pos, parentNodes, altKey }: { pos: number; parentNodes: string[]; altKey?: boolean },
): Promise<void> {
  if (altKey) return;
  if (!parentNodes.includes("Link")) return;
  const text = await editor.getText();
  const re = /\[([^\]]+)\]\(geo:[^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      await editor.navigate(match[1]);
      return;
    }
  }
}

/**
 * Completion handler for geolinks. Triggers when the cursor is inside the
 * label of a `[label](geo:)` link and searches Nominatim with the full label
 * text, returning up to 5 place suggestions.
 *
 * Selecting a result replaces the entire `[label](geo:)` with
 * `[display name](geo:lat,lon)` using the `to` field to extend the replacement
 * range beyond the cursor.
 *
 * @param context - Completion context with linePrefix text and cursor position
 * @returns Completion options with from/to range, or null if not in a geolink
 */
export async function completeGeolink(
  { linePrefix, pos }: { linePrefix: string; pos: number },
): Promise<{ from: number; options: { label: string; detail: string; apply: string }[] } | null> {
  // Cursor must be inside [ ... ] of a geolink — find last [ with no ] before cursor
  const labelMatch = /\[([^\]]*)$/.exec(linePrefix);
  if (!labelMatch) return null;

  // Text after cursor must complete the geolink: optional remaining label + ](geo:...)
  const fullText = await editor.getText();
  const afterCursor = fullText.slice(pos);
  const afterMatch = /^([^\]]*)\]\(geo:[^)]*\)/.exec(afterCursor);
  if (!afterMatch) return null;

  // Combine label text from both sides of the cursor
  const fullLabel = (labelMatch[1] + afterMatch[1]).trim();
  if (fullLabel.length < 2) return null;

  let results: any[];
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(fullLabel)}`,
      { headers: { "User-Agent": "SilverBullet-GeoNotes/1.0" } },
    );
    results = await resp.json();
  } catch (e) {
    console.error("Nominatim fetch error:", e);
    return null;
  }
  if (!results.length) return null;

  return {
    from: pos - labelMatch[1].length, // position right after the opening [
    to: pos + afterMatch[0].length,   // consume remaining label + ](geo:...)
    filter: false,
    options: results.map((r: any) => ({
      label: r.display_name,
      detail: `${r.lat}, ${r.lon}`,
      apply: `${r.name}](geo:${r.lat},${r.lon})`,
    })),
  };
}

/**
 * Page index event handler. Scans page content for embedded geolinks
 * (`[name](geo:lat,lng)`) and stores them in the SilverBullet object index
 * under the `"geolink"` tag so they can be queried efficiently.
 *
 * @param event - The page index event with `name` and `text` fields
 */
export async function indexGeoLinks(
  { name, text }: { name: string; text: string },
): Promise<void> {
  const objects: GeoLink[] = [];
  const regex = /\[([^\]]*)\]\(geo:([^,)]+),([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lat = Number(match[2].trim());
    const lng = Number(match[3].trim());
    if (isFinite(lat) && isFinite(lng)) {
      objects.push({
        ref: `${name}@${match.index}`,
        tag: "geolink",
        page: name,
        name: match[1] || `${lat}, ${lng}`,
        lat,
        lng,
      });
    }
  }
  await index.indexObjects(name, objects);
}


/**
 * Returns inline JS that defines `makeMarker(lat, lng)` using Phosphor icons.
 * Requires Leaflet and @phosphor-icons/web to already be loaded.
 */
function markerJS(marker: MarkerConfig): string {
  return `
    var _markerCfg = ${JSON.stringify(marker)};
    function makeMarker(lat, lng) {
      var iconName  = _markerCfg.icon || 'circle';
      var color     = _markerCfg.markerColor || '#bf616a';
      var iconColor = _markerCfg.iconColor || '#efeff4';
      var shape     = _markerCfg.shape || 'pin';
      var opacity   = _markerCfg.opacity !== undefined ? _markerCfg.opacity : 1;

      // Shape styles: the container div + optional tail for pin
      var shapeStyle, size, anchor, tail = '';
      var commonStyle = 'display:flex;align-items:center;justify-content:center;background:' + color + ';';
      var innerStyle = 'transform:rotate(0deg);';

      if (shape === 'circle') {
        size = [32, 32]; anchor = [16, 16];
        shapeStyle = commonStyle + 'width:32px;height:32px;border-radius:50%;';
      
      } else if (shape === 'square') {
        size = [32, 32]; anchor = [16, 16];
        shapeStyle = commonStyle + 'width:32px;height:32px;border-radius:4px;';
      
      } else if (shape === 'diamond') {
        size = [36, 36]; anchor = [18, 18];
        shapeStyle = commonStyle + 'width:26px;height:26px;';
        shapeStyle += 'transform:rotate(45deg);';
        innerStyle = 'transform:rotate(-45deg);';

      } else {
        // pin (default)
        size = [32, 32]; 
        anchor = [16, 32]; // Centers horizontally (16), points to bottom (32)
        
        shapeStyle = commonStyle + 'width:32px;height:32px;border-radius:50% 50% 50% 0;';
        shapeStyle += 'display:flex;align-items:center;justify-content:center;';
        shapeStyle += 'transform:rotate(-45deg);';
        
        // Rotate the icon back so it sits upright
        innerStyle = 'transform:rotate(45deg);display:flex;';
      }

      var iconStyle = 'color:' + iconColor + ';font-size:16px;';

      var html = '<div style="opacity:' + opacity + ';filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">'
               + '<div style="' + shapeStyle + '">'
               + '<div style="' + innerStyle + '">'
               + '<i class="ph-fill ph-' + iconName + '" style="' + iconStyle + '"></i>'
               + '</div></div>';

      return L.marker([lat, lng], {
        icon: L.divIcon({ html: html, className: '', iconSize: size, iconAnchor: anchor, popupAnchor: [0, -size[1]] }),
      });
    }
  `;
}

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
 * - `path` — Regex: show items whose page path matches
 * - `name` — Regex: show items whose display name matches
 * - `linkedFrom` — Regex: show items wiki-linked from pages matching this pattern
 * - `linkedTo` — Regex: show items whose page wiki-links to pages matching this pattern
 *
 * @param bodyText - Raw YAML string from inside the code fence
 * @param pageName - Name of the page containing the widget
 * @returns Widget content with HTML, script, and height
 */
export async function mapWidget(
  bodyText: string,
  pageName: string,
): Promise<{ html: string; script: string; height: number }> {
  let centerInfo: ReturnType<typeof parseCenter> = null;
  let zoom = 13;
  let height = 400;
  let zoomControl = true;
  let style = "osm";
  const query: GeoQuery = {};

  if (bodyText.trim()) {
    try {
      const parsed = parseYaml(bodyText) as Record<string, unknown>;
      centerInfo = parseCenter(parsed.center);
      if (typeof parsed.zoom === "number") zoom = parsed.zoom;
      if (typeof parsed.height === "number") height = parsed.height;
      if (typeof parsed.zoomControl === "boolean") zoomControl = parsed.zoomControl;
      if (typeof parsed.style === "string") style = parsed.style;
      if (typeof parsed.linkedFrom === "string") query.linkedFrom = parsed.linkedFrom;
      if (typeof parsed.linkedTo === "string") query.linkedTo = parsed.linkedTo;
      if (typeof parsed.path === "string") query.path = parsed.path;
      if (typeof parsed.name === "string") query.name = parsed.name;
    } catch { /* use defaults */ }
  }

  const tile = TILES[style] ?? TILES.osm;

  // Build the setView call dependening on center type
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

  // Build unified geo items from geonotes and geolinks, then apply query filters
  const config = await getConfig();
  let allItems: GeoItem[] = [];
  let debugError = "";
  try {
    const geoPages = await queryGeoPages(config.frontMatterLocationKey);
    const geoLinks = await index.queryLuaObjects<GeoLink>("geolink", {});
    allItems = [
      ...geoPages.map((p) => ({ type: "page" as const, name: p.name.split("/").pop() ?? p.name, page: p.name, lat: p.lat, lng: p.lng })),
      ...geoLinks.map((l) => ({ type: "link" as const, name: l.name, page: l.page, lat: l.lat, lng: l.lng })),
    ];
  } catch (e) {
    debugError = String(e);
  }

  let filteredItems = allItems;
  if (Object.keys(query).length > 0) {
    try {
      filteredItems = await applyQuery(allItems, query);
    } catch (e) {
      debugError += (debugError ? "\n" : "") + "query error: " + String(e);
    }
  }

  return {
    html: `<link rel="stylesheet" href="/.client/main.css">
    <style>${await asset.readAsset("geonotes", "assets/geonotes.css")}
      body, html {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      #map {
        width: 100%;
        height: ${height}px;
      }
    </style>
    <div id="map"></div>`,

    // DEBUG (shows results of all queries, and how many geoitems were found)
    // <div id="debug">
    //   <summary>debug</summary>
    //   <details>
    //   (${filteredItems.length}/${allItems.length}): ${JSON.stringify(filteredItems, null, 2).replace(/</g, "&lt;")}
    //   </details>
    // </div>`,

    script: `
      // --- FLAG PARENT START ---
      // some weird hacky shit to add an attribute to the iframe containing the map
      try {
        // Find the iframe we are currently in
        var frame = window.parent.document.querySelector('sb-fenced-code-iframe');
        // Look for a frame that contains THIS specific window
        var allFrames = window.parent.document.body.querySelectorAll('*');
        console.log("Total elements found:", allFrames.length);
        console.log("the fuck");
        for (var i = 0; i < allFrames.length; i++) {
          if (allFrames[i].contentWindow === window) {
            console.log("the fuck");
            allFrames[i].setAttribute('geonote-embedded-map', 'true');
            break;
          }
        }
      } catch(e) { console.error("Could not flag parent", e); }
      // --- FLAG PARENT END ---

      try {
        var _css = ${JSON.stringify(await asset.readAsset("geonotes", "assets/geonotes.css"))};
        var _style = window.parent.document.getElementById('sb-geonotes-style');
        if (!_style) {
          _style = window.parent.document.createElement('style');
          _style.id = 'sb-geonotes-style';
          window.parent.document.head.appendChild(_style);
        }
        _style.textContent = _css;
      } catch(_e) {}

      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      var ph = document.createElement('script');
      ph.src = 'https://unpkg.com/@phosphor-icons/web';
      document.head.appendChild(ph);

      var s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function() {
        ${markerJS(config.marker)}
        var map = L.map('map',{zoomControl:${zoomControl}});
        L.tileLayer(${JSON.stringify(tile.url)}, {
          maxZoom: ${tile.maxZoom}
        }).addTo(map);
        ${initView}
        var items = ${JSON.stringify(filteredItems)};
        var latLngs = [];
        items.forEach(function(item) {
          var marker = makeMarker(item.lat, item.lng);
          var popup = L.popup().setContent(
            '<b>' + item.name + '</b><br><a class="nav" href="#">Open \u2197</a>'
          );
          marker.bindPopup(popup);
          marker.on('popupopen', function() {
            popup.getElement().querySelector('.nav').addEventListener('click', function(e) {
              e.preventDefault();
              syscall('editor.navigate', {page: item.page});
            });
          });
          marker.addTo(map);
          latLngs.push([item.lat, item.lng]);
        });
        if (latLngs.length === 1) { map.setView(latLngs[0], 13); }
        else if (latLngs.length > 1) { map.fitBounds(latLngs, {padding: [40, 40]}); }
      };
      s.onerror = function() {
        document.getElementById('map').textContent = 'Failed to load Leaflet';
      };
      document.head.appendChild(s);
    `,
    height,
  };
}
