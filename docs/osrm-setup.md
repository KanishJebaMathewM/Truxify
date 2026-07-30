# Self-Hosting OSRM Setup Guide

This guide describes how to download, pre-process, and self-host the OpenStreetMap (OSRM) road routing engine locally to enable accurate distance and duration calculations.

---

## 1. Download OpenStreetMap Data for India

The road network data is downloaded from Geofabrik. Create a directory named `osrm-data` in your project root and download the India map data:

```bash
mkdir osrm-data
cd osrm-data
# Download the latest OpenStreetMap data for India (approx. 1.2 GB)
wget http://download.geofabrik.de/asia/india-latest.osm.pbf
```

---

## 2. Pre-Process the Map Data (Docker-based)

To avoid local compilation of the OSRM binaries, run the extraction, partitioning, and customization pipelines directly inside the `osrm/osrm-backend` Docker container.

Run these commands from the project root (where the `osrm-data` folder is located):

```bash
# 1. Extract road network using the car routing profile
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-extract -p /usr/local/share/osrm/profiles/car.lua /data/india-latest.osm.pbf

# 2. Partition the extracted network into cells
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-partition /data/india-latest.osm

# 3. Customize the routing cells for fast MLD routing queries
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-customize /data/india-latest.osm
```

---

## 3. Spin Up the OSRM Service

Start the container service defined in `docker-compose.yml`:

```bash
docker compose up -d osrm
```

This starts `osrm-routed` on host port `5002`.

---

## 4. Verification

Verify that your self-hosted OSRM instance is running and returning correct route data by making a HTTP request (e.g., routing between Mumbai and Delhi):

```bash
curl "http://localhost:5002/route/v1/driving/72.8777,19.0760;77.2090,28.6139?overview=false"
```

Response format:
```json
{
  "code": "Ok",
  "routes": [
    {
      "geometry": "...",
      "legs": [],
      "distance": 1415200.5,
      "duration": 94820.2,
      "weight_name": "routability",
      "weight": 94820.2
    }
  ],
  "waypoints": [...]
}
```
