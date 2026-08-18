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
  let flightPolyline = null;
  let userMarker = null;
  let routeSteps = [];
  let currentStepIndex = 0;
  
  // Transport Mode Settings
  let selectedMode = 'car';
  let routeColor = '#1a73e8'; // Default Blue for Drive
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

  // Tab Switcher
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

  // Color & Transport Mode Selection
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      
      selectedMode = target.dataset.mode;
      routeColor = target.dataset.color; // Unique color per mode
    });
  });

  // Geocoding Search Engine
  async function geocode(query, limit = 50) {
    if (!query || !query.trim()) return [];
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`);
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // Universal Live Autocomplete
  function attachAutocomplete(inputEl, resultsContainerId) {
    let debounceTimer;

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

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('active');
      }
    });
  }

  attachAutocomplete(document.getElementById('search-input'), 'search-results');
  attachAutocomplete(document.getElementById('start-input'), 'start-results');
  attachAutocomplete(document.getElementById('end-input'), 'end-results');

  // Multi-Mode Navigation Calculation
  document.getElementById('route-btn').addEventListener('click', async () => {
    const startInput = document.getElementById('start-input').value.trim();
    const endInput = document.getElementById('end-input').value.trim();

    if (!endInput) {
      statusMsg.textContent = "Please select a destination.";
      return;
    }

    statusMsg.textContent = "Calculating path...";

    try {
      const endData = await geocode(endInput, 1);
      if (!endData.length) {
        statusMsg.textContent = "Destination address not found.";
        return;
      }
      const endCoords = [parseFloat(endData[0].lat), parseFloat(endData[0].lon)];

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

      // Render mode route
      clearActiveRoutes();
      if (selectedMode === 'plane') {
        calculateFlightPath(startCoords, endCoords);
      } else {
        calculateRoadOrRailRoute(startCoords, endCoords);
      }

      updateVehicleMarker(startCoords[0], startCoords[1]);

      if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const currentLat = pos.coords.latitude;
            const currentLon = pos.coords.longitude;
            updateVehicleMarker(currentLat, currentLon);
            checkTurnAlerts(currentLat, currentLon);
          },
          (err) => console.warn("GPS tracking issue:", err.message),
          { enableHighAccuracy: true }
        );
      }
    } catch (e) {
      console.error(e);
      statusMsg.textContent = "Failed to calculate navigation path.";
    }
  });

  // Calculate Airplane Curved Flight Route
  function calculateFlightPath(start, end) {
    const midLat = (start[0] + end[0]) / 2 + 0.5; // Curved arc peak
    const midLon = (start[1] + end[1]) / 2;

    const latLngs = [start, [midLat, midLon], end];

    flightPolyline = L.polyline(latLngs, {
      color: routeColor, // Red dashed line for flight
      weight: 5,
      dashArray: '10, 10',
      lineCap: 'round'
    }).addTo(map);

    map.fitBounds(flightPolyline.getBounds(), { padding: [50, 50] });

    document.getElementById('nav-banner').classList.add('active');
    document.getElementById('nav-instruction').textContent = "Direct Flight Path";
    document.getElementById('nav-distance').textContent = `Est. ${Math.round(getDistanceMeters(start[0], start[1], end[0], end[1]) / 1000)} km`;
    statusMsg.textContent = "Flight Path Active.";
    speak("Starting flight route tracking.");
  }

  // Calculate Road or Train Route
  function calculateRoadOrRailRoute(start, end) {
    const profile = (selectedMode === 'train') ? 'car' : selectedMode;

    routingControl = L.Routing.control({
      waypoints: [L.latLng(start[0], start[1]), L.latLng(end[0], end[1])],
      router: L.Routing.osrmv1({ profile: profile }),
      lineOptions: { 
        styles: [{ color: routeColor, weight: selectedMode === 'train' ? 8 : 6 }] 
      },
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
      statusMsg.textContent = `${selectedMode.toUpperCase()} Route Active.`;
      speak(`Starting ${selectedMode} navigation.`);
    });
  }

  // Update Dynamic Vehicle Marker Icon
  function updateVehicleMarker(lat, lon) {
    map.setView([lat, lon], 14);

    let vehicleEmoji = '🚘';
    if (selectedMode === 'foot') vehicleEmoji = '🚶';
    if (selectedMode === 'bike') vehicleEmoji = '🚴';
    if (selectedMode === 'train') vehicleEmoji = '🚆';
    if (selectedMode === 'plane') vehicleEmoji = '✈️';

    if (!userMarker) {
      const icon = L.divIcon({
        className: 'car-marker-icon',
        html: vehicleEmoji,
        iconSize: [30, 30]
      });
      userMarker = L.marker([lat, lon], { icon: icon }).addTo(map);
    } else {
      userMarker.setLatLng([lat, lon]);
    }
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

  function clearActiveRoutes() {
    if (routingControl) map.removeControl(routingControl);
    if (flightPolyline) map.removeLayer(flightPolyline);
    if (userMarker) map.removeLayer(userMarker);

    routingControl = null;
    flightPolyline = null;
    userMarker = null;
    routeSteps = [];
  }

  // Clear Route Button
  document.getElementById('clear-route-btn').addEventListener('click', () => {
    clearActiveRoutes();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    document.getElementById('nav-banner').classList.remove('active');
    statusMsg.textContent = "Route Cleared.";
  });

  // Click to Drop Pin
  map.on('click', (e) => {
    L.marker([e.latlng.lat, e.latlng.lng]).addTo(map)
      .bindPopup(`Pinned Location<br>${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`).openPopup();
  });

  // Location Recenter
  document.getElementById('btn-location').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      L.marker([pos.coords.latitude, pos.coords.longitude]).addTo(map).bindPopup("Current Location").openPopup();
    });
  });
});
