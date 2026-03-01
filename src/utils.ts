/**
 * @file utils.ts
 * Utilty functions for Map View
 */

/********************************************************************************
 * Utility export functions
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
export function parseCenter(
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
export function parseLocation(loc: unknown): { lat: number; lng: number } | null {
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
export function makeRegex(pattern: string): RegExp {
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
export function extractWikiLinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}
