/**
 * Coordinate conversion utilities
 * Supports Belgian Lambert 72 (EPSG:31370) to WGS84 (GPS) conversion
 */

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
 *
 * This uses an approximation based on the projection parameters.
 * Accuracy is typically within 1-2 meters for most of Belgium.
 *
 * Belgian Lambert 72 parameters:
 * - Central meridian: 4.367486666666666° E
 * - Latitude of false origin: 90° N
 * - False easting: 150000.013 m
 * - False northing: 5400088.438 m
 * - Standard parallels: 49.8333° N and 51.1667° N
 */
export function belgianLambert72ToWGS84(x: number, y: number): GPSCoordinate {
  // Belgian Lambert 72 projection constants
  const n = 0.7716421928;      // Cone constant
  const F = 1.8121974321;      // Scaling factor
  const rho0 = 5522557.5304;   // Radius at latitude of origin
  const lambda0 = 0.076042943; // Central meridian in radians (4.367486666...°)

  // False origin
  const x0 = 150000.013;
  const y0 = 5400088.438;

  // Transform to projection coordinates
  const xp = x - x0;
  const yp = rho0 - (y - y0);

  // Calculate rho and theta
  const rho = Math.sqrt(xp * xp + yp * yp);
  const theta = Math.atan2(xp, yp);

  // Calculate latitude (iterative)
  const t = Math.pow(rho / (6378137 * F), 1 / n);

  // First approximation
  let phi = Math.PI / 2 - 2 * Math.atan(t);

  // Iterative refinement (3 iterations is usually enough)
  const e = 0.08181919084; // Eccentricity of WGS84
  for (let i = 0; i < 5; i++) {
    const sinPhi = Math.sin(phi);
    const eSinPhi = e * sinPhi;
    phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - eSinPhi) / (1 + eSinPhi), e / 2));
  }

  // Calculate longitude
  const lambda = theta / n + lambda0;

  // Convert to degrees
  const latitude = phi * 180 / Math.PI;
  const longitude = lambda * 180 / Math.PI;

  return { latitude, longitude };
}

/**
 * WGS84 to Belgian Lambert 72 conversion
 * Inverse of the above function
 */
export function wgs84ToBelgianLambert72(latitude: number, longitude: number): ModelCoordinate {
  // Belgian Lambert 72 projection constants
  const n = 0.7716421928;
  const F = 1.8121974321;
  const rho0 = 5522557.5304;
  const lambda0 = 0.076042943; // Central meridian in radians

  // False origin
  const x0 = 150000.013;
  const y0 = 5400088.438;

  // WGS84 ellipsoid
  const a = 6378137; // Semi-major axis
  const e = 0.08181919084; // Eccentricity

  // Convert to radians
  const phi = latitude * Math.PI / 180;
  const lambda = longitude * Math.PI / 180;

  // Calculate t
  const sinPhi = Math.sin(phi);
  const eSinPhi = e * sinPhi;
  const t = Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - eSinPhi) / (1 + eSinPhi), e / 2);

  // Calculate rho
  const rho = a * F * Math.pow(t, n);

  // Calculate theta
  const theta = n * (lambda - lambda0);

  // Calculate x, y
  const x = x0 + rho * Math.sin(theta);
  const y = y0 + rho0 - rho * Math.cos(theta);

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
