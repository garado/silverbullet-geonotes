import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { parse as parseYaml } from "@std/yaml";

function parseCenter(raw: unknown): { type: "coords"; lat: number; lng: number } | { type: "name"; name: string } | null {
  if (typeof raw === "string") {
    // Try "lat, lng" format
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (isFinite(lat) && isFinite(lng)) return { type: "coords", lat, lng };
    }
    // Otherwise treat as place name
    return { type: "name", name: raw };
  }
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = Number(raw[0]);
    const lng = Number(raw[1]);
    if (isFinite(lat) && isFinite(lng)) return { type: "coords", lat, lng };
  }
  return null;
}

export async function mapWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string; height: number }> {
  let centerInfo: ReturnType<typeof parseCenter> = null;
  let zoom = 13;
  let height = 400;
  let zoomControl = true;

  if (bodyText.trim()) {
    try {
      const parsed = parseYaml(bodyText) as Record<string, unknown>;
      centerInfo = parseCenter(parsed.center);
      if (typeof parsed.zoom === "number") zoom = parsed.zoom;
      if (typeof parsed.height === "number") height = parsed.height;
      if (typeof parsed.zoomControl === "boolean") zoomControl = parsed.zoomControl;
    } catch { /* use defaults */ }
  }

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

  return {
    html: `<style>body,html{margin:0;padding:0;}#map{width:100%;height:${height}px;}</style><div id="map"></div>`,
    script: `
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      var s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function() {
        var map = L.map('map',{zoomControl:${zoomControl}});
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
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
