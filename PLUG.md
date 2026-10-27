---
name: Library/garado/geonotes/PLUG
tags: meta/library
files:
- geonotes.plug.js
---

This library provides Obsidian Map View-like functionality to silverbullet.

## Supported features

- Geonotes (with configurable front matter key)
- Inline geolinks with location autocomplete
- Embedded map view to query and display your geoitems
    - Query support:
        - name
        - path
        - linkedTo
        - linkedFrom

## Sample config structure

Set this in your `CONFIG` page:

```lua
config.set("geonote", {
  -- Front matter key used to mark a page as a geonote (default: "location")
  frontMatterLocationKey = "location",

  -- API key for CartoDB's basemap tiles
  -- Get a free key here: https://carto.com/basemaps/apikey/
  cartoApiKey = "your-cartodb-api-key",

  -- Marker appearance rules
  -- See https://github.com/garado/silverbullet-geonotes for more examples
  markers = {
    { tag = "food", icon = "fork-knife", markerColor = "#d08770", shape = "pin" },
    { icon = "map-pin", markerColor = "#bf616a", shape = "pin" },
  },
})
```
