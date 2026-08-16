// Initialize map centered on London
const map = L.map('map').setView([51.505, -0.09], 13);

// Load OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let customMarkers = [];
let tempPopup = null;

// --- Load saved markers on initial run ---
loadSavedMarkers();

// --- 1. Map Click Event: Prompt for Label ---
map.on('click', function (e) {
  const { lat, lng } = e.latlng;

  // Form HTML inserted inside the popup
  const formHtml = `
    <div class="marker-form">
      <strong>Add Custom Label</strong>
      <input type="text" id="marker-label-input" placeholder="e.g., Favorite Cafe" autofocus />
      <button id="save-marker-btn">Save Pin</button>
    </div>
  `;

  // Open temporary popup at clicked position
  tempPopup = L.popup()
    .setLatLng([lat, lng])
    .setContent(formHtml)
    .openOn(map);

  // Focus input field once popup opens
  setTimeout(() => {
    const input = document.getElementById('marker-label-input');
    if (input) input.focus();
  }, 100);
});

// --- 2. Delegate Popup Button Click Event ---
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'save-marker-btn') {
    const input = document.getElementById('marker-label-input');
    const labelText = input.value.trim() || 'Custom Location';
    const latlng = tempPopup.getLatLng();

    createCustomMarker(latlng.lat, latlng.lng, labelText);
    saveMarkerData(latlng.lat, latlng.lng, labelText);

    map.closePopup();
  }
});

// --- Helper Functions ---

function createCustomMarker(lat, lng, label) {
  const marker = L.marker([lat, lng]).addTo(map);
  
  // Bind permanent label tooltip visible on hover/always, plus popup on click
  marker.bindPopup(`<b>${label}</b><br><small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small>`);
  marker.bindTooltip(label, { permanent: false, direction: 'top' });

  customMarkers.push(marker);
}

function saveMarkerData(lat, lng, label) {
  const saved = JSON.parse(localStorage.getItem('map_markers') || '[]');
  saved.push({ lat, lng, label });
  localStorage.setItem('map_markers', JSON.stringify(saved));
}

function loadSavedMarkers() {
  const saved = JSON.parse(localStorage.getItem('map_markers') || '[]');
  saved.forEach(item => {
    createCustomMarker(item.lat, item.lng, item.label);
  });
}

function clearAllMarkers() {
  customMarkers.forEach(marker => map.removeLayer(marker));
  customMarkers = [];
  localStorage.removeItem('map_markers');
  document.getElementById('results').textContent = 'All custom markers cleared.';
}

// Search function
async function searchLocation() {
  const query = document.getElementById('address-input').value;
  const resultsDiv = document.getElementById('results');
  if (!query) return;

  resultsDiv.textContent = 'Searching...';

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const displayName = data[0].display_name;

      map.setView([lat, lon], 14);
      createCustomMarker(lat, lon, displayName);
      saveMarkerData(lat, lon, displayName);
      resultsDiv.textContent = `Found and pinned: ${displayName}`;
    } else {
      resultsDiv.textContent = 'Location not found.';
    }
  } catch (error) {
    resultsDiv.textContent = 'Error searching location.';
  }
}

// User Geolocation
function locateUser() {
  const resultsDiv = document.getElementById('results');
  if (!navigator.geolocation) {
    resultsDiv.textContent = 'Geolocation not supported.';
    return;
  }

  resultsDiv.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude: lat, longitude: lon } = position.coords;
      map.setView([lat, lon], 15);
      createCustomMarker(lat, lon, 'My Location');
      resultsDiv.textContent = 'Centered on your location.';
    },
    () => { resultsDiv.textContent = 'Unable to retrieve location.'; }
  );
}

// Event Listeners
document.getElementById('search-btn').addEventListener('click', searchLocation);
document.getElementById('location-btn').addEventListener('click', locateUser);
document.getElementById('clear-markers-btn').addEventListener('click', clearAllMarkers);
document.getElementById('address-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchLocation();
});
