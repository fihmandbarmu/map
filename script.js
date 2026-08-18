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

  // Get Current Location Helper
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

  // High-Volume Geocoding Engine
  async function geocode(query, limit = 50) {
    if (!query || !query.trim()) return [];
    try {
      // Increased search limit to return maximum match density
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`);
      const data = await res.json();
      return data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // Universal Live Autocomplete Generator for Inputs
  function attachAutocomplete(inputEl, resultsContainerId) {
    let debounceTimer;

    // Create dropdown container if missing
    let dropdown = document.getElementById(resultsContainerId);
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = resultsContainerId;
      dropdown.className = 'results-dropdown';
      inputEl.parentNode.appendChild(dropdown);
    }

    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = inputEl.value.trim();

      if (query.length === 0) {
        dropdown.classList.remove('active');
        return;
      }

      // Debounce requests to allow fast typing on any character/number
      debounceTimer = setTimeout(async () => {
        const results = await geocode(query, 50);
        if (results.length > 0) {
          dropdown.innerHTML = '';
          results.forEach(item => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.textContent = item.display_name;
            div.addEventListener('click', () => {
              inputEl.value = item.display_name;
              dropdown.classList.remove('active');
              
              if (inputEl.id === 'search-input') {
                const lat = parseFloat(item.lat);
                const lon = parseFloat(item.lon);
                map.setView([lat, lon], 15);
                L.marker([lat, lon]).addTo(map).bindPopup(item.display_name).openPopup();
              }
            });
            dropdown.appendChild(div);
          });
          dropdown.classList.add('active');
        } else {
          dropdown.classList.remove('active');
        }
      }, 250);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('active');
      }
    });
  }

  // Attach dynamic autocomplete to Search, Start, and End directions inputs
  attachAutocomplete(document.getElementById('search-input'), 'search-results');
  attachAutocomplete(document.getElementById('start-input'), 'start-results');
  attachAutocomplete(document.getElementById('end-input'), 'end-results');

  // Navigation Button Handler
  document.getElementById('route-btn').addEventListener('click', async () => {
    const startInput = document.getElementById('start-input').value.trim();
    const endInput = document.getElementById('end-input').value.trim();

    if (!endInput) {
      statusMsg.textContent = "Please choose a destination point.";
      return;
    }

    statusMsg.textContent = "Calculating route...";

    try {
      // 1. Resolve Destination
      const endData = await geocode(endInput, 1);
      if (!endData.length) {
        statusMsg.textContent = "Destination address not found.";
        return;
      }
      const endCoords = [parseFloat(endData[0].lat), parseFloat(endData[0].lon)];

      // 2. Resolve Start (Default to live GPS if start is empty)
      let startCoords = null;
      if (startInput) {
        const startData = await geocode(startInput, 1);
        if (!startData.length) {
          statusMsg.textContent = "Starting location not found.";
          return;
        }
        startCoords = [parseFloat(startData[0].lat), parseFloat(startData[0].lon)];
      } else {
        statusMsg.textContent = "Acquiring GPS location...";
        try {
          startCoords = await GetCurrentPosition();
        } catch (err) {
          statusMsg.textContent = "GPS unavailable. Type a start location manually.";
          return;
        }
      }

      // 3. Render Route and Start Live GPS Tracking
      calculateRoute(startCoords, endCoords);
      updateCarMarker(startCoords[0], startCoords[1]);

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
      statusMsg.textContent = "Failed to calculate navigation route.";
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
      statusMsg.textContent = "Could not find a valid route between these locations.";
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
