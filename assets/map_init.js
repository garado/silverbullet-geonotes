/**
 * @file map_init.js
 * Client-side Leaflet map initialisation.
 *
 * Reads all dynamic data from the #geo-data JSON script element injected by
 * mapWidget, so this file can be served as a plain static asset.
 *
 * Data contract (geo-data JSON):
 *   items       – GeoItem[]
 *   tile        – { url, maxZoom }
 *   zoomControl – boolean
 *   center      – { type: "coords", lat, lng, zoom }
 *               | { type: "name",   name, zoom }
 *               | { type: "none" }
 *   markers     – MarkerConfig[] (ordered rules; first with matching tag wins, then first without tag)
 *   css         – geonotes.css string (injected into parent document)
 */
(function () {
  var cfg = JSON.parse(document.getElementById('geo-data').textContent);

  // --- FLAG PARENT ---
  // Set an attribute on our own iframe so parent-document CSS selectors can
  // target embedded maps (e.g. hide the copy button, remove padding).
  try {
    var allFrames = window.parent.document.body.querySelectorAll('*');
    for (var i = 0; i < allFrames.length; i++) {
      if (allFrames[i].contentWindow === window) {
        allFrames[i].setAttribute('geonote-embedded-map', 'true');
        break;
      }
    }
  } catch (_e) {}

  // --- INJECT CSS into parent document (idempotent) ---
  try {
    var _style = window.parent.document.getElementById('sb-geonotes-style');
    if (!_style) {
      _style = window.parent.document.createElement('style');
      _style.id = 'sb-geonotes-style';
      window.parent.document.head.appendChild(_style);
    }
    _style.textContent = cfg.css;
  } catch (_e) {}

  // --- LOAD DEPS ---
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);

  var ph = document.createElement('script');
  ph.src = 'https://unpkg.com/@phosphor-icons/web';
  document.head.appendChild(ph);

  var s = document.createElement('script');
  s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  s.onload = function () {

    // --- MAKE MARKER ---
    // Returns the first marker rule whose tag matches one of the item's tags,
    // falling back to the first rule with no tag, then an empty object.
    function resolveMarker(item) {
      var rules = cfg.markers;
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].tag && item.tags.indexOf(rules[i].tag) !== -1) return rules[i];
      }
      for (var i = 0; i < rules.length; i++) {
        if (!rules[i].tag) return rules[i];
      }
      return {};
    }

    function makeMarker(lat, lng, markerCfg) {
      var iconName  = markerCfg.icon        || 'circle';
      var color     = markerCfg.markerColor || '#bf616a';
      var iconColor = markerCfg.iconColor   || '#efeff4';
      var shape     = markerCfg.shape       || 'pin';
      var opacity   = markerCfg.opacity !== undefined ? markerCfg.opacity : 1;

      var shapeStyle, size, anchor;
      var commonStyle = 'display:flex;align-items:center;justify-content:center;background:' + color + ';';
      var innerStyle  = 'transform:rotate(0deg);';

      if (shape === 'circle') {
        size = [32, 32]; anchor = [16, 16];
        shapeStyle = commonStyle + 'width:32px;height:32px;border-radius:50%;';

      } else if (shape === 'square') {
        size = [32, 32]; anchor = [16, 16];
        shapeStyle = commonStyle + 'width:32px;height:32px;border-radius:4px;';

      } else if (shape === 'diamond') {
        size = [36, 36]; anchor = [18, 18];
        shapeStyle = commonStyle + 'width:26px;height:26px;transform:rotate(45deg);';
        innerStyle = 'transform:rotate(-45deg);';

      } else {
        // pin (default)
        size   = [32, 32];
        anchor = [16, 32]; // horizontal centre, points at bottom
        shapeStyle = commonStyle
          + 'width:32px;height:32px;border-radius:50% 50% 50% 0;'
          + 'display:flex;align-items:center;justify-content:center;'
          + 'transform:rotate(-45deg);';
        innerStyle = 'transform:rotate(45deg);display:flex;';
      }

      var iconStyle = 'color:' + iconColor + ';font-size:16px;';
      var html =
        '<div style="opacity:' + opacity + ';filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))">'
        + '<div style="' + shapeStyle + '">'
        + '<div style="' + innerStyle + '">'
        + '<i class="ph-fill ph-' + iconName + '" style="' + iconStyle + '"></i>'
        + '</div></div>';

      return L.marker([lat, lng], {
        icon: L.divIcon({
          html: html,
          className: '',
          iconSize: size,
          iconAnchor: anchor,
          popupAnchor: [0, -size[1]],
        }),
      });
    }

    // --- MAP INIT ---
    var map = L.map('map', { zoomControl: cfg.zoomControl });
    L.tileLayer(cfg.tile.url, { maxZoom: cfg.tile.maxZoom }).addTo(map);

    if (cfg.center.type === 'coords') {
      map.setView([cfg.center.lat, cfg.center.lng], cfg.center.zoom);
    } else if (cfg.center.type === 'name') {
      fetch(
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
        + encodeURIComponent(cfg.center.name)
      )
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.length === 0) return;
          map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], cfg.center.zoom);

          // Replace the place-name in the fence with the resolved coordinates so
          // future loads skip this geocoding round-trip entirely.
          var coords = data[0].lat + ', ' + data[0].lon;
          var escapedName = cfg.center.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          var re = new RegExp('([ \\t]*center:[ \\t]*)["\']?' + escapedName + '["\']?');
          syscall('editor.getText').then(function (pageText) {
            var newText = pageText.replace(re, '$1' + coords);
            if (newText === pageText) return;
            // Find the minimal changed slice to use replaceRange
            var from = 0;
            while (from < pageText.length && pageText[from] === newText[from]) from++;
            var oldEnd = pageText.length;
            var newEnd = newText.length;
            while (oldEnd > from && newEnd > from && pageText[oldEnd - 1] === newText[newEnd - 1]) {
              oldEnd--; newEnd--;
            }
            syscall('editor.replaceRange', from, oldEnd, newText.slice(from, newEnd));
          });
        });
    } else {
      map.setView([0, 0], 2);
    }

    // --- ADD MARKERS ---
    var latLngs = [];
    cfg.items.forEach(function (item) {
      var marker = makeMarker(item.lat, item.lng, resolveMarker(item));
      var popup  = L.popup().setContent(
        '<b>' + item.name + '</b><br><a class="nav" href="#">Open \u2197</a>'
      );
      marker.bindPopup(popup);
      marker.on('popupopen', function () {
        popup.getElement().querySelector('.nav').addEventListener('click', function (e) {
          e.preventDefault();
          syscall('editor.navigate', { page: item.page });
        }, { once: true });
      });
      marker.addTo(map);
      latLngs.push([item.lat, item.lng]);
    });

    if (cfg.center.type === 'none') {
      if (latLngs.length === 1) {
        map.setView(latLngs[0], 13);
      } else if (latLngs.length > 1) {
        map.fitBounds(latLngs, { padding: [40, 40] });
      }
    }
  };

  s.onerror = function () {
    document.getElementById('map').textContent = 'Failed to load Leaflet';
  };
  document.head.appendChild(s);
})();
