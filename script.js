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

  // Get Current Location Helper (Promise-based)
  function GetCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
      } else {
        navigator.geolocation.getCurrentPosition(
          pos => resolve([pos.coords.latitude, pos.coords.longitude]),
          err => reject(err),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    });
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
    if (!query || !query.trim()) return null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
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

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const results = await res.json();
      if (results && results.length > 0) {
        dropdown.innerHTML = '';
        results.slice(0, 5).forEach(item => {
          const div = document.createElement('div');
          div.className = 'result-item';
          div.textContent = item.display_name;
          div.addEventListener('click', () => {
            const lat = parseFloat(item.lat);
            const lon = parseFloat(item.lon);
            map.setView([lat, lon], 15);
            L.marker([lat, lon]).addTo(map).bindPopup(item.display_name).openPopup();
            dropdown.classList.remove('active');
            searchInput.value = item.display_name.split(',')[0];
          });
          dropdown.appendChild(div);
        });
        dropdown.classList.add('active');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // --- START NAVIGATION BUTTON FIX ---
  document.getElementById('route-btn').addEventListener('click', async () => {
    const startInput = document.getElementById('start-input').value.trim();
    const endInput = document.getElementById('end-input').value.trim();

    if (!endInput) {
      statusMsg.textContent = "Please type a destination address.";
      return;
    }

    statusMsg.textContent = "Calculating route...";

    try {
      // 1. Resolve Destination Coordinates
      const endCoords = await geocode(endInput);
      if (!endCoords) {
        statusMsg.textContent = "Destination address not found.";
        return;
      }

      // 2. Resolve Start Coordinates (Use GPS if start box is empty)
      let startCoords = null;
      if (startInput) {
        startCoords = await geocode(startInput);
        if (!startCoords) {
          statusMsg.textContent = "Starting address not found.";
          return;
        }
      } else {
        statusMsg.textContent = "Acquiring GPS location...";
        try {
          startCoords = await GetCurrentPosition();
        } catch (err) {
          statusMsg.textContent = "GPS location unavailable. Please enter a start location manually.";
          return;
        }
      }

      // 3. Render Route instantly
      calculateRoute(startCoords, endCoords);
      updateCarMarker(startCoords[0], startCoords[1]);

      // 4. Start Live GPS Tracking
      if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const currentLat = pos.coords.latitude;
            const currentLon = pos.coords.longitude;
            updateCarMarker(currentLat, currentLon);
            checkTurnAlerts(currentLat, currentLon);
          },
          (err) => console.warn("GPS tracking warning:", err.message),
          { enableHighAccuracy: true }
        );
      }
    } catch (e) {
      console.error(e);
      statusMsg.textContent = "Failed to start navigation. Please try again.";
    }
  });

  function updateCarMarker(lat, lon) {
    map.setView([lat, lon], 16);

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
      show: false,
      addWaypoints: false
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

    routingControl.on('routingerror', () => {
      statusMsg.textContent = "Could not find a route between these locations.";
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
    if (userMarker) map.removeLayer(userMarker);
    
    routingControl = null;
    userMarker = null;
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
