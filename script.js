// Initialize map centered on London
const map = L.map('map').setView([51.505, -0.09], 13);

// Load OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let currentMarker = null;

// Search function using OpenStreetMap Nominatim API
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

      if (currentMarker) map.removeLayer(currentMarker);
      currentMarker = L.marker([lat, lon]).addTo(map).bindPopup(displayName).openPopup();

      resultsDiv.textContent = `Found: ${displayName}`;
    } else {
      resultsDiv.textContent = 'Location not found.';
    }
  } catch (error) {
    resultsDiv.textContent = 'Error searching location.';
  }
}

// Get user geolocation
function locateUser() {
  const resultsDiv = document.getElementById('results');
  
  if (!navigator.geolocation) {
    resultsDiv.textContent = 'Geolocation is not supported by your browser.';
    return;
  }

  resultsDiv.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      map.setView([lat, lon], 15);

      if (currentMarker) map.removeLayer(currentMarker);
      currentMarker = L.marker([lat, lon]).addTo(map).bindPopup('You are here!').openPopup();

      resultsDiv.textContent = 'Location centered.';
    },
    () => {
      resultsDiv.textContent = 'Unable to retrieve your location.';
    }
  );
}

// Event Listeners
document.getElementById('search-btn').addEventListener('click', searchLocation);
document.getElementById('location-btn').addEventListener('click', locateUser);
document.getElementById('address-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchLocation();
});
