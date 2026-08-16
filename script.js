document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('map');
  
  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });

  const map = L.map('map', {
    center: [51.505, -0.09],
    zoom: 16,
    layers: [streetLayer]
  });

  let routingControl = null;
  let watchId = null;
  let userMarker = null;
  let routeSteps = [];
  let currentStepIndex = 0;
  let selectedMode = 'car';
  let isNavigating = false;

  // Web Speech API for voice instructions
  const synth = window.speechSynthesis;

  function speakAlert(text) {
    if ('speechSynthesis' in window) {
      synth.cancel(); // Interrupt previous alert
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      synth.speak(utterance);
    }
  }

  // --- Calculate Distance Between Coordinates (Haversine Formula) ---
  function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // --- Calculate Bearing/Heading Direction ---
  function getBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  // --- Mode Selection ---
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      selectedMode = e.target.dataset.mode;
    });
  });

  // --- Start Turn-by-Turn Navigation ---
  async function startNavigation(destinationQuery) {
    if (!navigator.geolocation) {
      alert("Geolocation required for active car navigation.");
      return;
    }

    // Resolve Destination
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destinationQuery)}`);
    const data = await res.json();
    if (!data.length) {
      alert("Destination not found.");
      return;
    }
    const dest = [parseFloat(data[0].lat), parseFloat(data[0].lon)];

    // Begin Live GPS Tracking
    watchId = navigator.geolocation.watchPosition(
      (pos) => handlePositionUpdate(pos, dest),
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  }

  function handlePositionUpdate(position, dest) {
    const { latitude: lat, longitude: lon, heading } = position.coords;

    // Initialize or Move Car Marker
    if (!userMarker) {
      const carIcon = L.divIcon({ className: 'user-car-marker' });
      userMarker = L.marker([lat, lon], { icon: carIcon }).addTo(map);
      
      // Calculate initial route once position is established
      buildRoute([lat, lon], dest);
    } else {
      userMarker.setLatLng([lat, lon]);
    }

    map.setView([lat, lon], 17);

    // --- CAR MODE: Rotate Camera in Direction of Movement ---
    if (selectedMode === 'car') {
      const moveHeading = heading !== null && !isNaN(heading) ? heading : 0;
      mapElement.style.transform = `rotate(-${moveHeading}deg)`;
    } else {
      mapElement.style.transform = `rotate(0deg)`;
    }

    // --- Check Proximity & Trigger Maneuver Alerts ---
    if (routeSteps.length > 0 && currentStepIndex < routeSteps.length) {
      const step = routeSteps[currentStepIndex];
      const distToNextStep = getDistanceMeters(lat, lon, step.latLng.lat, step.latLng.lng);

      // Update Nav HUD
      document.getElementById('nav-banner').classList.add('active');
      document.getElementById('nav-instruction').textContent = step.instruction;
      document.getElementById('nav-distance').textContent = `In ${Math.round(distToNextStep)} meters`;

      // Trigger Voice Alert within 50 meters of turn
      if (distToNextStep < 50 && !step.alerted) {
        speakAlert(`In 50 meters, ${step.instruction}`);
        step.alerted = true;
        currentStepIndex++;
      }
    }
  }

  function buildRoute(start, end) {
    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
      waypoints: [L.latLng(start[0], start[1]), L.latLng(end[0], end[1])],
      router: L.Routing.osrmv1({ profile: selectedMode }),
      lineOptions: { styles: [{ color: '#4285F4', weight: 6 }] },
      show: false
    }).addTo(map);

    // Extract step instructions from route for the Alert Engine
    routingControl.on('routesfound', (e) => {
      const instructions = e.routes[0].instructions;
      const coordinates = e.routes[0].coordinates;

      routeSteps = instructions.map(i => ({
        instruction: i.text,
        latLng: coordinates[i.index],
        alerted: false
      }));
      
      currentStepIndex = 0;
      speakAlert("Starting navigation.");
    });
  }

  document.getElementById('route-btn').addEventListener('click', () => {
    const dest = document.getElementById('end-input').value;
    if (dest) startNavigation(dest);
  });
});
