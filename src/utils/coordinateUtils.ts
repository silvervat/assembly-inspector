/**
 * Coordinate conversion utilities
 * Supports Belgian Lambert 72 (EPSG:31370) to WGS84 (GPS) conversion
 * Uses proj4js for accurate transformations
 */

import proj4 from 'proj4';

// Define Belgian Lambert 72 (EPSG:31370) projection
// Official definition from https://epsg.io/31370
proj4.defs('EPSG:31370', '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 +lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs');

// WGS84 is already defined in proj4 as 'EPSG:4326' or 'WGS84'

export interface GPSCoordinate {
  latitude: number;
  longitude: number;
}

export interface ModelCoordinate {
  x: number;
  y: number;
  z?: number;
}

/**
 * Belgian Lambert 72 (EPSG:31370) to WGS84 conversion
 * Uses proj4js for accurate transformation including datum shift
 *
 * @param x - X coordinate in Belgian Lambert 72 (meters)
 * @param y - Y coordinate in Belgian Lambert 72 (meters)
 * @returns GPS coordinates in WGS84 (latitude, longitude in degrees)
 */
export function belgianLambert72ToWGS84(x: number, y: number): GPSCoordinate {
  // proj4 returns [longitude, latitude] for geographic coordinates
  const [longitude, latitude] = proj4('EPSG:31370', 'WGS84', [x, y]);
  return { latitude, longitude };
}

/**
 * WGS84 to Belgian Lambert 72 conversion
 * Uses proj4js for accurate transformation including datum shift
 *
 * @param latitude - Latitude in degrees (WGS84)
 * @param longitude - Longitude in degrees (WGS84)
 * @returns Model coordinates in Belgian Lambert 72 (x, y in meters)
 */
export function wgs84ToBelgianLambert72(latitude: number, longitude: number): ModelCoordinate {
  // proj4 expects [longitude, latitude] for geographic coordinates
  const [x, y] = proj4('WGS84', 'EPSG:31370', [longitude, latitude]);
  return { x, y };
}

/**
 * Calculate distance between two GPS coordinates in meters
 * Uses Haversine formula
 */
export function gpsDistance(coord1: GPSCoordinate, coord2: GPSCoordinate): number {
  const R = 6371000; // Earth's radius in meters

  const lat1 = coord1.latitude * Math.PI / 180;
  const lat2 = coord2.latitude * Math.PI / 180;
  const deltaLat = (coord2.latitude - coord1.latitude) * Math.PI / 180;
  const deltaLon = (coord2.longitude - coord1.longitude) * Math.PI / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Format GPS coordinate for display
 */
export function formatGPSCoordinate(coord: GPSCoordinate, precision: number = 6): string {
  return `${coord.latitude.toFixed(precision)}, ${coord.longitude.toFixed(precision)}`;
}

/**
 * Create Google Maps URL for a GPS coordinate
 */
export function googleMapsUrl(coord: GPSCoordinate): string {
  return `https://www.google.com/maps?q=${coord.latitude},${coord.longitude}`;
}
