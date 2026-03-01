/**
 * @file geo.ts
 * Data/query layer.
 */

import { asset, editor, index, space, system } from "@silverbulletmd/silverbullet/syscalls";
import { parse as parseYaml } from "@std/yaml";
import { GeoPage, GeoLink, GeoItem, GeoQuery, MarkerConfig } from "./types.ts";
import { parseLocation, parseCenter, extractWikiLinks, makeRegex } from "./utils.ts";

/**
 * Reads geonotes configuration from the SilverBullet CONFIG page.
 * Users can configure via `config.set { geonote = { ... } }` in CONFIG.
 *
 * @returns Parsed geonotes config with defaults applied
 */
export async function getConfig(): Promise<{ frontMatterLocationKey: string; marker: MarkerConfig }> {
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
export async function queryGeoPages(locationKey: string): Promise<GeoPage[]> {
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
export async function applyQuery(items: GeoItem[], query: GeoQuery): Promise<GeoItem[]> {
  let result = items;

  if (query.path) {
    const re = makeRegex(query.path);
    result = result.filter((i) => re.test(i.page));
  }

  if (query.name) {
    const re = makeRegex(query.name);
    result = result.filter((i) => re.test(i.name));
  }

  if (query.tag) {
    result = result.filter((i) => i.tags.includes(query.tag!));
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
