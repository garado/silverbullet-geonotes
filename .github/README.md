
# Silverbullet Map View

Like Obsidian Map View, but for Silverbullet! (Currently for SB v2.6.1)

<img width="1465" height="1370" alt="image" src="https://github.com/user-attachments/assets/6da35da0-0a05-411d-abf8-d63118c96098" />

## Features

### Embedded map widget

Insert a map anywhere in your notes with a ` ```map ``` ` code fence.

**Slash command:** `/map` inserts a ready-to-use template.

**Config options:**

| Option | Description |
|---|---|
| `center` | Place name or coordinates (`lat, lon`) |
| `zoom` | Zoom level (default: 13) |
| `height` | Widget height in pixels (default: 400) |
| `style` | Tile style: `dark`, `light`, or `auto` for auto switching on theme |
| `zoomControl` | Show zoom buttons (default: true) |
| `path` | Regex filter on page path; use `.` for the current page only |
| `name` | Regex filter on geolink/geonote display name |
| `tag` | Show only items with this tag |
| `linkedFrom` | Show items from pages wiki-linked from pages matching this regex |
| `linkedTo` | Show items from pages that wiki-link to pages matching this regex |

**Map behavior:**
- Hover a pin to see its popup
- Popup shows the item name, description (if any), image (if any), and an "Open" link that navigates to the exact line in the source page
- Refresh button (top-right) re-reads the current page and updates markers immediately, without waiting for a page re-index

### Geolinks

Inline links that encode a geographic location: `[Place Name](geo:lat,lon)`.

- Geolinks will show up as pins in embedded map widgets. The map pin popup can optionally show an image if you include one with: `[Place Name](geo:lat,lon,optionalImageUrl)`
- Freeform description text on the same line shows in the map popup: `[Bolinao](geo:16.38,119.89) #geo/hike Waterfalls and caves`
- Clicking a geolink navigates to the page with that name (TODO might be broken)
- Tags can be attached after the link: `[Mount Pinatubo](geo:15.14,120.34) #geo/hike`

**Slash commands:**
- `/geolink` — starts a geolink with location autocomplete
- Type `[geo:` followed by a place name to trigger autocomplete (Nominatim/OpenStreetMap)

### Geonotes

Pages with a `location` frontmatter field are automatically treated as geonotes and appear on maps.

```yaml
---
location: [14.5995, 120.9842]
---
```

The location key is configurable via the SilverBullet CONFIG page.

### Marker rules

Marker appearance can be customized per tag via the CONFIG page:

```
config.set {
  geonote = {
    markers = [
      { tag = "geo/hike", icon = "mountains", markerColor = "#5e81ac", shape = "pin" },
      { icon = "map-pin", markerColor = "#bf616a" }
    ]
  }
}
```

Supported shapes: `pin`, `circle`, `square`, `diamond`. Icons are from the [Phosphor icon set](https://phosphoricons.com/).

## Development

If you're on Nix, enter the devshell with:

```
nix develop
```

To build:

```
npm run build
```
