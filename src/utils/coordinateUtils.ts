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
 * Uses polynomial approximation based on NGI (Belgian National Geographic Institute).
 * Accuracy is typically within 1 meter for Belgium.
 *
 * Reference: https://www.ngi.be/
 */
export function belgianLambert72ToWGS84(x: number, y: number): GPSCoordinate {
  // Step 1: Lambert 72 to Belgian geographic (BD72 datum)
  // Using Lambert Conformal Conic projection inverse

  // Lambert 72 projection parameters (Hayford 1924 ellipsoid)
  const a = 6378388;           // Semi-major axis (Hayford)
  const e = 0.08199188998;     // Eccentricity (Hayford)
  const lambda0 = 0.076042943; // Central meridian 4°21'24.983" in radians
  const phi0 = 1.57079632679;  // Latitude of origin 90° in radians
  const phi1 = 0.86975574;     // Standard parallel 1: 49°50' in radians
  const phi2 = 0.89302680;     // Standard parallel 2: 51°10' in radians
  const x0 = 150000.013;       // False easting
  const y0 = 5400088.438;      // False northing

  // Calculate cone constant n
  const m1 = Math.cos(phi1) / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
  const m2 = Math.cos(phi2) / Math.sqrt(1 - e * e * Math.sin(phi2) * Math.sin(phi2));

  const t0 = Math.tan(Math.PI / 4 - phi0 / 2) / Math.pow((1 - e * Math.sin(phi0)) / (1 + e * Math.sin(phi0)), e / 2);
  const t1 = Math.tan(Math.PI / 4 - phi1 / 2) / Math.pow((1 - e * Math.sin(phi1)) / (1 + e * Math.sin(phi1)), e / 2);
  const t2 = Math.tan(Math.PI / 4 - phi2 / 2) / Math.pow((1 - e * Math.sin(phi2)) / (1 + e * Math.sin(phi2)), e / 2);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);

  // Inverse projection
  const xp = x - x0;
  const yp = rho0 - (y - y0);
  const rho = Math.sign(n) * Math.sqrt(xp * xp + yp * yp);
  const theta = Math.atan2(xp, yp);

  const t = Math.pow(rho / (a * F), 1 / n);

  // Iterative calculation of latitude
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 10; i++) {
    const sinPhi = Math.sin(phi);
    const eSinPhi = e * sinPhi;
    const phiNew = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - eSinPhi) / (1 + eSinPhi), e / 2));
    if (Math.abs(phiNew - phi) < 1e-12) break;
    phi = phiNew;
  }

  const lambda = theta / n + lambda0;

  // Step 2: BD72 to WGS84 datum transformation (Molodensky)
  // Transformation parameters BD72 -> WGS84
  const dx = -106.8686;
  const dy = 52.2978;
  const dz = -103.7239;

  // Hayford ellipsoid
  const aH = 6378388;
  const fH = 1 / 297;

  // WGS84 ellipsoid
  const aW = 6378137;
  const fW = 1 / 298.257223563;

  const da = aW - aH;
  const df = fW - fH;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);

  const eH2 = 2 * fH - fH * fH;
  const Rn = aH / Math.sqrt(1 - eH2 * sinPhi * sinPhi);
  const Rm = aH * (1 - eH2) / Math.pow(1 - eH2 * sinPhi * sinPhi, 1.5);

  const dPhi = (-dx * sinPhi * cosLambda - dy * sinPhi * sinLambda + dz * cosPhi
               + da * (Rn * eH2 * sinPhi * cosPhi) / aH
               + df * (Rm * aH / (1 - fH) + Rn * (1 - fH) / 1) * sinPhi * cosPhi) / Rm;

  const dLambda = (-dx * sinLambda + dy * cosLambda) / (Rn * cosPhi);

  // Final WGS84 coordinates
  const latitude = (phi + dPhi) * 180 / Math.PI;
  const longitude = (lambda + dLambda) * 180 / Math.PI;

  return { latitude, longitude };
}

/**
 * WGS84 to Belgian Lambert 72 conversion
 * Inverse of the above function
 */
export function wgs84ToBelgianLambert72(latitude: number, longitude: number): ModelCoordinate {
  // Step 1: WGS84 to BD72 datum transformation (inverse Molodensky)
  const dx = 106.8686;   // Note: reversed signs for inverse
  const dy = -52.2978;
  const dz = 103.7239;

  // WGS84 ellipsoid
  const aW = 6378137;
  const fW = 1 / 298.257223563;

  // Hayford ellipsoid (BD72)
  const aH = 6378388;
  const fH = 1 / 297;

  // Convert to radians
  let phi = latitude * Math.PI / 180;
  let lambda = longitude * Math.PI / 180;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);

  const eW2 = 2 * fW - fW * fW;
  const Rn = aW / Math.sqrt(1 - eW2 * sinPhi * sinPhi);
  const Rm = aW * (1 - eW2) / Math.pow(1 - eW2 * sinPhi * sinPhi, 1.5);

  const da = aH - aW;
  const df = fH - fW;

  const dPhi = (-dx * sinPhi * cosLambda - dy * sinPhi * sinLambda + dz * cosPhi
               + da * (Rn * eW2 * sinPhi * cosPhi) / aW
               + df * (Rm * aW / (1 - fW) + Rn * (1 - fW)) * sinPhi * cosPhi) / Rm;

  const dLambda = (-dx * sinLambda + dy * cosLambda) / (Rn * cosPhi);

  // BD72 geographic coordinates
  phi = phi + dPhi;
  lambda = lambda + dLambda;

  // Step 2: BD72 geographic to Lambert 72 projection
  const a = 6378388;           // Hayford semi-major axis
  const e = 0.08199188998;     // Hayford eccentricity
  const lambda0 = 0.076042943; // Central meridian
  const phi0 = 1.57079632679;  // Latitude of origin 90°
  const phi1 = 0.86975574;     // Standard parallel 1: 49°50'
  const phi2 = 0.89302680;     // Standard parallel 2: 51°10'
  const x0 = 150000.013;
  const y0 = 5400088.438;

  // Calculate cone constant n
  const m1 = Math.cos(phi1) / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
  const m2 = Math.cos(phi2) / Math.sqrt(1 - e * e * Math.sin(phi2) * Math.sin(phi2));

  const t0 = Math.tan(Math.PI / 4 - phi0 / 2) / Math.pow((1 - e * Math.sin(phi0)) / (1 + e * Math.sin(phi0)), e / 2);
  const t1 = Math.tan(Math.PI / 4 - phi1 / 2) / Math.pow((1 - e * Math.sin(phi1)) / (1 + e * Math.sin(phi1)), e / 2);
  const t2 = Math.tan(Math.PI / 4 - phi2 / 2) / Math.pow((1 - e * Math.sin(phi2)) / (1 + e * Math.sin(phi2)), e / 2);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);

  // Forward projection
  const sinPhiP = Math.sin(phi);
  const t = Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - e * sinPhiP) / (1 + e * sinPhiP), e / 2);
  const rho = a * F * Math.pow(t, n);
  const theta = n * (lambda - lambda0);

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
