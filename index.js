import { createServer } from "http";
import { readFileSync } from "fs";

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const data = await fetchJSON(url);
  if (!data.results?.length) throw new Error("City not found");
  const { latitude, longitude, name, country } = data.results[0];
  return { latitude, longitude, name, country };
}

async function getWeatherData(lat, lon) {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=5`;
  const airQualityUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone`;

  const [weather, airQuality] = await Promise.all([
    fetchJSON(weatherUrl),
    fetchJSON(airQualityUrl)
  ]);

  return { weather, airQuality };
}

function getWeatherDescription(code) {
  const descriptions = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
  };
  return descriptions[code] || "Unknown";
}

function getWeatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 3) return "🌤";
  if (code <= 48) return "🌫";
  if (code <= 55) return "🌦";
  if (code <= 65) return "🌧";
  if (code <= 75) return "🌨";
  if (code <= 82) return "🌧";
  return "⛈";
}

function getAQILevel(aqi) {
  if (aqi <= 50) return { label: "Good", color: "#4ade80" };
  if (aqi <= 100) return { label: "Moderate", color: "#facc15" };
  if (aqi <= 150) return { label: "Unhealthy for Sensitive Groups", color: "#fb923c" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#f87171" };
  if (aqi <= 300) return { label: "Very Unhealthy", color: "#c084fc" };
  return { label: "Hazardous", color: "#991b1b" };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const path = url.pathname;

  if (path === "/api/weather" && req.method === "GET") {
    const city = url.searchParams.get("city") || "Singapore";
    try {
      const geo = await geocodeCity(city);
      const { weather, airQuality } = await getWeatherData(geo.latitude, geo.longitude);

      const current = weather.current;
      const daily = weather.daily;
      const aqi = airQuality.current;
      const aqiLevel = getAQILevel(aqi.us_aqi);

      const forecast = daily.time.map((date, i) => ({
        date,
        weatherCode: daily.weather_code[i],
        emoji: getWeatherEmoji(daily.weather_code[i]),
        description: getWeatherDescription(daily.weather_code[i]),
        tempMax: daily.temperature_2m_max[i],
        tempMin: daily.temperature_2m_min[i],
        precipProbability: daily.precipitation_probability_max[i]
      }));

      const alerts = [];
      if (current.wind_speed_10m > 50) alerts.push({ type: "wind", message: "High wind warning" });
      if (current.precipitation > 10) alerts.push({ type: "rain", message: "Heavy rain alert" });
      if (aqi.us_aqi > 150) alerts.push({ type: "air", message: "Poor air quality advisory" });
      if (current.temperature_2m > 38) alerts.push({ type: "heat", message: "Extreme heat warning" });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        city: geo.name,
        country: geo.country,
        current: {
          temperature: current.temperature_2m,
          feelsLike: current.apparent_temperature,
          humidity: current.relative_humidity_2m,
          windSpeed: current.wind_speed_10m,
          windDirection: current.wind_direction_10m,
          precipitation: current.precipitation,
          weatherCode: current.weather_code,
          emoji: getWeatherEmoji(current.weather_code),
          description: getWeatherDescription(current.weather_code)
        },
        airQuality: {
          aqi: aqi.us_aqi,
          level: aqiLevel.label,
          color: aqiLevel.color,
          pm25: aqi.pm2_5,
          pm10: aqi.pm10,
          no2: aqi.nitrogen_dioxide,
          ozone: aqi.ozone
        },
        sunrise: daily.sunrise[0],
        sunset: daily.sunset[0],
        forecast,
        alerts
      }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  try {
    const html = readFileSync('index.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
