import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function mapWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string; height: number }> {
  return {
    html: `<style>body,html{margin:0;padding:0;}#map{width:100%;height:400px;}</style><div id="map"></div>`,
    script: `
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      var s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = function() {
        var map = L.map('map').setView([48.8566, 2.3522], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(map);
      };
      s.onerror = function() {
        document.getElementById('map').textContent = 'Failed to load Leaflet';
      };
      document.head.appendChild(s);
    `,
    height: 400,
  };
}
