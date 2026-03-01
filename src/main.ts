/**
 * @file main.ts
 * Contains SilverBullet event handlers + mapWidget that orchestrates API calls
 * and stitches the JS together
 */

/********************************************************************************
 * Imports
 ********************************************************************************/

import { asset, editor, index } from "@silverbulletmd/silverbullet/syscalls";
import { parse as parseYaml } from "@std/yaml";
import { GeoLink, GeoItem, GeoQuery } from "./types.ts";
import { parseCenter } from "./utils.ts";
import { getConfig, queryGeoPages, applyQuery } from "./geo.ts"

/********************************************************************************
 * Constants
 ********************************************************************************/

/** Available map tile styles. */
const TILES: Record<string, { url: string; maxZoom: number }> = {
  osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 },
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", maxZoom: 20 },
  light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", maxZoom: 20 },
  topo: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", maxZoom: 17 },
};


/********************************************************************************
 * Functions
 ********************************************************************************/

/**
 * Click handler for geolinks.
 *
 * Navigates to the SilverBullet page named after
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
 * Completion handler for geolinks.
 *
 * Triggers when the cursor is inside the label of a `[label](geo:)` link and
 * searches Nominatim with the full label text, returning up to 5 place suggestions.
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
 * Page index event handler.
 *
 * Scans page content for embedded geolinks (`[name](geo:lat,lng)`) and
 * stores them in the SilverBullet object index under the `"geolink"` tag so
 * they can be queried efficiently.
 *
 * @param event - The page index event with `name` and `text` fields
 */
export async function indexGeoLinks(
  { name, text }: { name: string; text: string },
): Promise<void> {
  const objects: GeoLink[] = [];
  const regex = /\[([^\]]*)\]\(geo:([^,)]+),([^)]+)\)((?:\s+#[\w/-]+)*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lat = Number(match[2].trim());
    const lng = Number(match[3].trim());
    if (isFinite(lat) && isFinite(lng)) {
      const tags = (match[4] ?? "").match(/#[\w/-]+/g)?.map((t) => t.slice(1)) ?? [];
      objects.push({
        ref: `${name}@${match.index}`,
        tag: "geolink",
        page: name,
        name: match[1] || `${lat}, ${lng}`,
        lat,
        lng,
        tags,
      });
    }
  }
  await index.indexObjects(name, objects);
}


/**
 * SilverBullet code widget handler for ```map fences.
 *
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
      if (typeof parsed.tag === "string") query.tag = parsed.tag;
    } catch { /* use defaults */ }
  }

  const tile = TILES[style] ?? TILES.osm;

  // Normalise center into the JSON shape consumed by map_init.js
  type CenterData =
    | { type: "coords"; lat: number; lng: number; zoom: number }
    | { type: "name"; name: string; zoom: number }
    | { type: "none" };
  let center: CenterData;
  if (centerInfo?.type === "coords") {
    center = { type: "coords", lat: centerInfo.lat, lng: centerInfo.lng, zoom };
  } else if (centerInfo?.type === "name") {
    center = { type: "name", name: centerInfo.name, zoom };
  } else {
    center = { type: "none" };
  }

  // Build unified geo items from geonotes and geolinks, then apply query filters
  const config = await getConfig();
  let allItems: GeoItem[] = [];
  try {
    const geoPages = await queryGeoPages(config.frontMatterLocationKey);
    const geoLinks = await index.queryLuaObjects<GeoLink>("geolink", {});
    allItems = [
      ...geoPages.map((p) => ({ type: "page" as const, name: p.name.split("/").pop() ?? p.name, page: p.name, lat: p.lat, lng: p.lng, tags: [] })),
      ...geoLinks.map((l) => ({ type: "link" as const, name: l.name, page: l.page, lat: l.lat, lng: l.lng, tags: l.tags ?? [] })),
    ];
  } catch { /* leave allItems empty */ }

  let items = allItems;
  if (Object.keys(query).length > 0) {
    try {
      items = await applyQuery(allItems, query);
    } catch { /* use unfiltered items */ }
  }

  const css = await asset.readAsset("geonotes", "assets/geonotes.css");
  const mapInitJs = await asset.readAsset("geonotes", "assets/map_init.js");

  const geoData = JSON.stringify({ items, tile, zoomControl, center, markers: config.markers, css })
    .replace(/<\/script>/gi, "<\\/script>");

  return {
    html: `<style>
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        height: ${height}px !important;
        overflow: hidden !important;
      }
      #map { width: 100%; height: 100%; }
    </style>
    <script id="geo-data" type="application/json">${geoData}</script>
    <div id="map"></div>`,
    script: mapInitJs,
    height,
  };
}
