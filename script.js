document.addEventListener('DOMContentLoaded', () => {
  // Tile Layer Configurations
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri'
  });

  // Initialize Map
  const map = L.map('map', {
    center: [51.505, -0.09], // Default London
    zoom: 13,
    layers: [streetLayer]
  });

  let routingControl = null;
  let activeMarkers = [];
  let selectedMode = 'car';

  const statusMsg = document.getElementById('status-message');

  // --- Tab Switcher Logic ---
  document.getElementById('tab-search').addEventListener('click', () => switchTab('search'));
  document.getElementById('tab-directions').addEventListener('click', () => switchTab('directions'));

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    if (tab === 'search') {
      document.getElementById('tab-search').classList.add('active');
      document.getElementById('panel-search').classList.add('active');
    } else {
      document.getElementById('tab-directions').classList.add('active');
      document.getElementById('panel-directions').classList.add('active');
    }
  }

  // --- Map Layer Switcher ---
  document.getElementById('btn-streets').addEventListener('click', function() {
    map.removeLayer(satelliteLayer);
    map.addLayer(streetLayer);
    this.classList.add('active');
    document.getElementById('btn-satellite').classList.remove('active');
  });

  document.getElementById('btn-satellite').addEventListener('click', function() {
    map.removeLayer(streetLayer);
    map.addLayer(satelliteLayer);
    this.classList.add('active');
    document.getElementById('btn-streets').classList.remove('active');
  });

  // --- Travel Mode Switcher ---
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      selectedMode = e.target.dataset.mode;
    });
  });

  // --- Geocoding Function (Nominatim API) ---
  async function geocode(query) {
    if (!query) return null;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          name: data[0].display_name
        };
      }
    } catch (err) {
      console.error("Geocoding failed:", err);
    }
    return null;
  }

  // --- Single Location Search ---
  async function performSearch() {
    const input = document.getElementById('search-input').value;
    statusMsg.textContent = "Searching...";
    
    const result = await geocode(input);
    if (result) {
      map.setView([result.lat, result.lon], 14);
      addMarker(result.lat, result.lon, result.name);
      statusMsg.textContent = `Found: ${result.name.split(',')[0]}`;
    } else {
      statusMsg.textContent = "Location not found. Try another query.";
    }
  }

  document.getElementById('search-btn').addEventListener('click', performSearch);
  document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // --- Directions & Routing Engine ---
  document.getElementById('route-btn').addEventListener('click', async () => {
    const startVal = document.getElementById('start-input').value;
    const endVal = document.getElementById('end-input').value;

    statusMsg.textContent = "Calculating route...";

    const startLoc = await geocode(startVal);
    const endLoc = await geocode(endVal);

    if (!startLoc || !endLoc) {
      statusMsg.textContent = "Could not resolve one or both locations.";
      return;
    }

    if (routingControl) {
      map.removeControl(routingControl);
    }

    // Set up routing
    routingControl = L.Routing.control({
      waypoints: [
        L.latLng(startLoc.lat, startLoc.lon),
        L.latLng(endLoc.lat, endLoc.lon)
      ],
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
        profile: selectedMode
      }),
      lineOptions: {
        styles: [{ color: '#4285F4', weight: 6, opacity: 0.8 }]
      },
      show: true,
      addWaypoints: false
    }).addTo(map);

    statusMsg.textContent = "Route loaded successfully.";
  });

  document.getElementById('clear-route-btn').addEventListener('click', () => {
    if (routingControl) {
      map.removeControl(routingControl);
      routingControl = null;
      statusMsg.textContent = "Route cleared.";
    }
  });

  // --- Click to Drop Custom Pin ---
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    addMarker(lat, lng, `Dropped Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    statusMsg.textContent = "Pin added to map.";
  });

  function addMarker(lat, lng, title) {
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`<b>${title}</b>`).openPopup();
    activeMarkers.push(marker);
  }

  // --- Geolocation ---
  document.getElementById('btn-location').addEventListener('click', () => {
    if (!navigator.geolocation) {
      statusMsg.textContent = "Geolocation is not supported by your browser.";
      return;
    }

    statusMsg.textContent = "Finding your position...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        map.setView([lat, lon], 15);
        addMarker(lat, lon, "Your Current Location");
        statusMsg.textContent = "Centered on your position.";
      },
      () => {
        statusMsg.textContent = "Location access denied or unavailable.";
      }
    );
  });
});
