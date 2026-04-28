/**
 * @file types.ts
 * Custom types for Map View
 */

/********************************************************************************
 * Types and interfaces
 ********************************************************************************/

/** A page with parsed geographic coordinates. */
export interface GeoPage {
  name: string;
  lat: number;
  lng: number;
}

/** An indexed geolink extracted from page content. */
export interface GeoLink {
  ref: string;
  tag: string;
  page: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  description?: string;
}

/** A unified geo item from either a geopage or geolink source. */
export interface GeoItem {
  type: "page" | "link";
  /** Display name: page name for geonotes, link label for geolinks. */
  name: string;
  /** Page containing this item (same as name for geonotes). */
  page: string;
  lat: number;
  lng: number;
  tags: string[];
  description?: string;
}

/** Marker appearance config from the CONFIG `geonote.markers` array. */
export interface MarkerConfig {
  tag?: string;         // Item tag to match (omit for the default/fallback rule)
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
export interface GeoQuery {
  /** Show items whose containing page is wiki-linked from pages matching this pattern. */
  linkedFrom?: string;
  /** Show items whose containing page has a wiki link to pages matching this pattern. */
  linkedTo?: string;
  /** Show items whose containing page path matches this pattern. */
  path?: string;
  /** Show items whose display name matches this pattern (page name or geolink label). */
  name?: string;
  /** Show items that have this tag (exact match). */
  tag?: string;
}

