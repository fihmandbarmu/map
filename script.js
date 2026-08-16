document.addEventListener('DOMContentLoaded', () => {
  // Tile Server Layers
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Esri'
  });

  // Map Initialization
  const map = L.map('map', {
    center: [51.505, -0.09],
    zoom: 14,
    layers: [streetLayer]
  });

  let routingControl = null;
  let userMarker = null;
  let routeSteps = [];
  let currentStepIndex = 0;
  let selectedMode = 'car';
  let watchId = null;

  const statusMsg = document.getElementById('status-message');

  // Text-To-Speech Output
  function speak(text) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  }

  // Haversine Distance Formula
  function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dp/2) * Math.sin(dp/2) +
              Math.cos(p1) * Math.cos(p2) *
              Math.sin(dl/2) * Math.sin(dl/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // UI Tabs
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

  // Layer Toggles
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

  // Mode Selection
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      selectedMode = e.target.dataset.mode;
    });
  });

  // Geocoding Search Helper
  async function geocode(query) {
    if (!query) return null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }

  // Live Dropdown Suggestions
  const searchInput = document.getElementById('search-input');
  const dropdown = document.getElementById('search-results');

  searchInput.addEventListener('input', async () => {
    const query = searchInput.value;
    if (query.length < 3) {
      dropdown.classList.remove('active');
      return;
    }

    const results = await geocode(query);
    if (results) {
      dropdown.innerHTML = '';
      results.slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.textContent = item.display_name;
        div.addEventListener('click', () => {
          map.setView([item.lat, item.lon], 15);
          L.marker([item.lat, item.lon]).addTo(map).bindPopup(item.display_name).openPopup();
          dropdown.classList.remove('active');
          searchInput.value = item.display_name.split(',')[0];
        });
        dropdown.appendChild(div);
      });
      dropdown.classList.add('active');
    }
  });

  // Navigation Execution
  document.getElementById('route-btn').addEventListener('click', async () => {
    const startInput = document.getElementById('start-input').value;
    const endInput = document.getElementById('end-input').value;

    statusMsg.textContent = "Locating endpoints...";

    const startData = await geocode(startInput);
    const endData = await geocode(endInput);

    if (!endData) {
      statusMsg.textContent = "Destination point not found.";
      return;
    }

    const end = { lat: parseFloat(endData[0].lat), lon: parseFloat(endData[0].lon) };

    if (navigator.geolocation) {
      if (watchId) navigator.geolocation.clearWatch(watchId);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = startData ? parseFloat(startData[0].lat) : pos.coords.latitude;
          const lon = startData ? parseFloat(startData[0].lon) : pos.coords.longitude;

          updateCarMarker(lat, lon);

          if (!routingControl) {
            calculateRoute([lat, lon], [end.lat, end.lon]);
          } else {
            checkTurnAlerts(lat, lon);
          }
        },
        () => { statusMsg.textContent = "GPS Access Denied."; },
        { enableHighAccuracy: true }
      );
    }
  });

  function updateCarMarker(lat, lon) {
    map.setView([lat, lon], 17);

    if (!userMarker) {
      const carIcon = L.divIcon({
        className: 'car-marker-icon',
        html: '🚘',
        iconSize: [30, 30]
      });
      userMarker = L.marker([lat, lon], { icon: carIcon }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
  }

  function calculateRoute(start, end) {
    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
      waypoints: [L.latLng(start[0], start[1]), L.latLng(end[0], end[1])],
      router: L.Routing.osrmv1({ profile: selectedMode }),
      lineOptions: { styles: [{ color: '#1a73e8', weight: 6 }] },
      show: false
    }).addTo(map);

    routingControl.on('routesfound', (e) => {
      const route = e.routes[0];
      routeSteps = route.instructions.map(i => ({
        text: i.text,
        latLng: route.coordinates[i.index],
        alerted: false
      }));

      currentStepIndex = 0;
      document.getElementById('nav-banner').classList.add('active');
      statusMsg.textContent = "Route Active.";
      speak("Starting navigation.");
    });
  }

  function checkTurnAlerts(lat, lon) {
    if (!routeSteps.length || currentStepIndex >= routeSteps.length) return;

    const step = routeSteps[currentStepIndex];
    const dist = getDistanceMeters(lat, lon, step.latLng.lat, step.latLng.lng);

    document.getElementById('nav-instruction').textContent = step.text;
    document.getElementById('nav-distance').textContent = `In ${Math.round(dist)} meters`;

    if (dist < 50 && !step.alerted) {
      speak(`In 50 meters, ${step.text}`);
      step.alerted = true;
      currentStepIndex++;
    }
  }

  // Clear Active Routes
  document.getElementById('clear-route-btn').addEventListener('click', () => {
    if (routingControl) map.removeControl(routingControl);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    routingControl = null;
    document.getElementById('nav-banner').classList.remove('active');
    statusMsg.textContent = "Route Cleared.";
  });

  // Click to Drop Pin
  map.on('click', (e) => {
    L.marker([e.latlng.lat, e.latlng.lng]).addTo(map)
      .bindPopup(`Pinned Location<br>${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`).openPopup();
  });

  // Recenter Geolocation Button
  document.getElementById('btn-location').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      L.marker([pos.coords.latitude, pos.coords.longitude]).addTo(map).bindPopup("Current Location").openPopup();
    });
  });
});
