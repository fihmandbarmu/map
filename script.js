// Map Tile Layers
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 18, attribution: 'Tiles &copy; Esri'
});

// Initialize Map
const map = L.map('map', {
  center: [51.505, -0.09],
  zoom: 13,
  layers: [streetLayer]
});

let routingControl = null;
let customMarkers = [];
let selectedMode = 'driving';

// Tab Switcher Logic
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

// Layer Toggle Controls
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

// Travel Mode Selection
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    selectedMode = e.target.dataset.mode;
  });
});

// Geocoding Search
async function geocode(query) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.length > 0 ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
}

document.getElementById('search-btn').addEventListener('click', async () => {
  const query = document.getElementById('search-input').value;
  const coords = await geocode(query);
  if (coords) {
    map.setView(coords, 14);
    addPin(coords[0], coords[1], query);
  } else {
    alert('Location not found.');
  }
});

// Routing Engine
document.getElementById('route-btn').addEventListener('click', async () => {
  const startQuery = document.getElementById('start-input').value;
  const endQuery = document.getElementById('end-input').value;

  const startCoords = await geocode(startQuery);
  const endCoords = await geocode(endQuery);

  if (startCoords && endCoords) {
    calculateRoute(startCoords, endCoords);
  } else {
    alert('Could not resolve both locations.');
  }
});

function calculateRoute(start, end) {
  if (routingControl) map.removeControl(routingControl);

  routingControl = L.Routing.control({
    waypoints: [L.latLng(start[0], start[1]), L.latLng(end[0], end[1])],
    router: L.Routing.osrmv1({ profile: selectedMode }),
    lineOptions: { styles: [{ color: '#4285F4', weight: 6 }] },
    createMarker: () => null // Hide default routing markers
  }).addTo(map);
}

document.getElementById('clear-route-btn').addEventListener('click', () => {
  if (routingControl) map.removeControl(routingControl);
});

// Click Map to Add Custom Pin
map.on('click', (e) => {
  const { lat, lng } = e.latlng;
  addPin(lat, lng, `Dropped Pin (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
});

function addPin(lat, lng, label) {
  const marker = L.marker([lat, lng]).addTo(map).bindPopup(`<b>${label}</b>`).openPopup();
  customMarkers.push(marker);
}

// User Location
document.getElementById('btn-location').addEventListener('click', () => {
  navigator.geolocation.getCurrentPosition(pos => {
    const coords = [pos.coords.latitude, pos.coords.longitude];
    map.setView(coords, 15);
    addPin(coords[0], coords[1], "Your Location");
  });
});
