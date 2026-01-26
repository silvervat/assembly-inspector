/**
 * Coordinate transformation utilities
 * Supports Helmert 2D transformation for calibrating local model coordinates to GPS
 * Uses proj4js for projection transformations
 */

import proj4 from 'proj4';
import {
  COORDINATE_SYSTEMS,
  CalibrationPoint,
  CalibrationQuality,
  HelmertTransformParams,
  ProjectCoordinateSettings,
  getCalibrationQuality,
} from '../supabase';

// ============================================
// TYPES
// ============================================

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D extends Point2D {
  z: number;
}

export interface GPSPoint {
  lat: number;
  lng: number;
  altitude?: number;
}

export interface CalibrationResult {
  params: HelmertTransformParams;
  quality: CalibrationQualityResult;
}

export interface CalibrationQualityResult {
  rmse: number;           // Root Mean Square Error (m)
  maxError: number;       // Maximum error (m)
  errors: number[];       // Individual point errors (m)
  quality: CalibrationQuality;
}

// ============================================
// PROJ4 DEFINITIONS
// ============================================

// Register all coordinate systems with proj4
export function initializeProjections(): void {
  for (const cs of COORDINATE_SYSTEMS) {
    if (cs.epsg_code && cs.proj4_string) {
      proj4.defs(`EPSG:${cs.epsg_code}`, cs.proj4_string);
    }
  }
}

// Initialize projections on module load
initializeProjections();

// ============================================
// PROJECTION CONVERSIONS
// ============================================

/**
 * Convert WGS84 GPS coordinates to projection coordinates
 */
export function gpsToProjection(
  lat: number,
  lng: number,
  epsgCode: number
): Point2D {
  const [x, y] = proj4('EPSG:4326', `EPSG:${epsgCode}`, [lng, lat]);
  return { x, y };
}

/**
 * Convert projection coordinates to WGS84 GPS
 */
export function projectionToGps(
  x: number,
  y: number,
  epsgCode: number
): GPSPoint {
  const [lng, lat] = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [x, y]);
  return { lat, lng };
}

// ============================================
// HELMERT 2D TRANSFORMATION
// ============================================

/**
 * Calculate Helmert 2D transformation parameters from calibration points
 * Uses least squares method for best fit
 *
 * @param modelPoints - Points in model coordinates
 * @param projectedPoints - Corresponding points in projection coordinates
 * @returns Transformation parameters
 */
export function calculateHelmert2D(
  modelPoints: Point2D[],
  projectedPoints: Point2D[]
): Omit<HelmertTransformParams, 'type' | 'origin_model' | 'origin_gps'> {
  const n = modelPoints.length;

  if (n < 2) {
    throw new Error('At least 2 points required for Helmert transformation');
  }

  // Calculate centroids
  const modelCentroid: Point2D = {
    x: modelPoints.reduce((sum, p) => sum + p.x, 0) / n,
    y: modelPoints.reduce((sum, p) => sum + p.y, 0) / n,
  };

  const projCentroid: Point2D = {
    x: projectedPoints.reduce((sum, p) => sum + p.x, 0) / n,
    y: projectedPoints.reduce((sum, p) => sum + p.y, 0) / n,
  };

  // Center the points
  const modelCentered = modelPoints.map(p => ({
    x: p.x - modelCentroid.x,
    y: p.y - modelCentroid.y,
  }));

  const projCentered = projectedPoints.map(p => ({
    x: p.x - projCentroid.x,
    y: p.y - projCentroid.y,
  }));

  // Calculate transformation parameters using least squares
  let sumXX = 0, sumXY = 0, sumYX = 0, sumYY = 0;
  let sumX2Y2 = 0;

  for (let i = 0; i < n; i++) {
    const mx = modelCentered[i].x;
    const my = modelCentered[i].y;
    const px = projCentered[i].x;
    const py = projCentered[i].y;

    sumXX += mx * px;
    sumXY += mx * py;
    sumYX += my * px;
    sumYY += my * py;
    sumX2Y2 += mx * mx + my * my;
  }

  // Prevent division by zero
  if (sumX2Y2 === 0) {
    return {
      translation: projCentroid,
      rotation_rad: 0,
      rotation_deg: 0,
      scale: 1,
    };
  }

  // a = scale * cos(rotation)
  // b = scale * sin(rotation)
  const a = (sumXX + sumYY) / sumX2Y2;
  const b = (sumXY - sumYX) / sumX2Y2;

  const scale = Math.sqrt(a * a + b * b);
  const rotation_rad = Math.atan2(b, a);
  const rotation_deg = rotation_rad * (180 / Math.PI);

  // Calculate translation
  const cos = Math.cos(rotation_rad);
  const sin = Math.sin(rotation_rad);

  const translation: Point2D = {
    x: projCentroid.x - scale * (cos * modelCentroid.x - sin * modelCentroid.y),
    y: projCentroid.y - scale * (sin * modelCentroid.x + cos * modelCentroid.y),
  };

  return {
    translation,
    rotation_rad,
    rotation_deg,
    scale,
  };
}

/**
 * Apply Helmert 2D transformation to a point
 */
export function applyHelmert(
  point: Point2D,
  params: Pick<HelmertTransformParams, 'translation' | 'rotation_rad' | 'scale'>
): Point2D {
  const { translation, rotation_rad, scale } = params;
  const cos = Math.cos(rotation_rad);
  const sin = Math.sin(rotation_rad);

  return {
    x: translation.x + scale * (cos * point.x - sin * point.y),
    y: translation.y + scale * (sin * point.x + cos * point.y),
  };
}

/**
 * Apply inverse Helmert 2D transformation (projection -> model)
 */
export function inverseHelmert(
  projPoint: Point2D,
  params: Pick<HelmertTransformParams, 'translation' | 'rotation_rad' | 'scale'>
): Point2D {
  const { translation, rotation_rad, scale } = params;
  const cos = Math.cos(-rotation_rad);
  const sin = Math.sin(-rotation_rad);

  const shifted: Point2D = {
    x: projPoint.x - translation.x,
    y: projPoint.y - translation.y,
  };

  return {
    x: (cos * shifted.x - sin * shifted.y) / scale,
    y: (sin * shifted.x + cos * shifted.y) / scale,
  };
}

// ============================================
// CALIBRATION QUALITY
// ============================================

/**
 * Calculate calibration quality metrics
 */
export function calculateCalibrationQuality(
  modelPoints: Point2D[],
  projectedPoints: Point2D[],
  params: Pick<HelmertTransformParams, 'translation' | 'rotation_rad' | 'scale'>
): CalibrationQualityResult {
  const errors: number[] = [];

  for (let i = 0; i < modelPoints.length; i++) {
    // Apply transformation to model point
    const predicted = applyHelmert(modelPoints[i], params);

    // Calculate distance to actual projection point
    const error = Math.sqrt(
      Math.pow(predicted.x - projectedPoints[i].x, 2) +
      Math.pow(predicted.y - projectedPoints[i].y, 2)
    );
    errors.push(error);
  }

  const rmse = Math.sqrt(
    errors.reduce((sum, e) => sum + e * e, 0) / errors.length
  );
  const maxError = Math.max(...errors);
  const quality = getCalibrationQuality(rmse);

  return { rmse, maxError, errors, quality };
}

// ============================================
// FULL CALIBRATION WORKFLOW
// ============================================

/**
 * Perform full calibration from calibration points
 *
 * @param points - Calibration points with model and GPS coordinates
 * @param settings - Project coordinate settings (for EPSG code)
 * @param modelUnitsToMeters - Conversion factor (e.g., 0.001 for mm to m)
 */
export function performCalibration(
  points: CalibrationPoint[],
  epsgCode: number,
  modelUnitsToMeters: number = 0.001
): CalibrationResult {
  // Filter active points
  const activePoints = points.filter(p => p.is_active);

  if (activePoints.length < 2) {
    throw new Error('At least 2 active calibration points required');
  }

  // Convert model coordinates to meters
  const modelPoints: Point2D[] = activePoints.map(p => ({
    x: p.model_x * modelUnitsToMeters,
    y: p.model_y * modelUnitsToMeters,
  }));

  // Convert GPS coordinates to projection
  const projectedPoints: Point2D[] = activePoints.map(p =>
    gpsToProjection(p.gps_latitude, p.gps_longitude, epsgCode)
  );

  // Calculate transformation
  const baseParams = calculateHelmert2D(modelPoints, projectedPoints);

  // Calculate quality
  const quality = calculateCalibrationQuality(modelPoints, projectedPoints, baseParams);

  // Build full params with origins
  const params: HelmertTransformParams = {
    type: 'helmert_2d',
    ...baseParams,
    origin_model: {
      x: activePoints[0].model_x,
      y: activePoints[0].model_y,
    },
    origin_gps: {
      lat: activePoints[0].gps_latitude,
      lng: activePoints[0].gps_longitude,
    },
  };

  return { params, quality };
}

// ============================================
// COORDINATE CONVERSION API
// ============================================

/**
 * Convert model coordinates to GPS
 */
export function modelToGps(
  modelX: number,
  modelY: number,
  _modelZ: number | undefined, // eslint-disable-line @typescript-eslint/no-unused-vars
  settings: ProjectCoordinateSettings
): GPSPoint {
  const cs = COORDINATE_SYSTEMS.find(c => c.id === settings.coordinate_system_id);

  if (!cs) {
    throw new Error(`Unknown coordinate system: ${settings.coordinate_system_id}`);
  }

  // Convert model units to meters
  let xMeters = modelX;
  let yMeters = modelY;

  if (settings.model_units === 'millimeters') {
    xMeters /= 1000;
    yMeters /= 1000;
  } else if (settings.model_units === 'feet') {
    xMeters *= 0.3048;
    yMeters *= 0.3048;
  }

  // If model has real coordinates, convert directly
  if (settings.model_has_real_coordinates && cs.epsg_code) {
    return projectionToGps(xMeters, yMeters, cs.epsg_code);
  }

  // If local system with calibration
  if (settings.transform_matrix && cs.epsg_code) {
    const projected = applyHelmert({ x: xMeters, y: yMeters }, settings.transform_matrix);
    return projectionToGps(projected.x, projected.y, cs.epsg_code);
  }

  // For local system without calibration, use first point as reference if available
  if (settings.transform_matrix?.origin_gps) {
    // Simple offset from origin
    return settings.transform_matrix.origin_gps;
  }

  throw new Error('Project not calibrated');
}

/**
 * Convert GPS coordinates to model coordinates
 */
export function gpsToModel(
  lat: number,
  lng: number,
  settings: ProjectCoordinateSettings
): Point3D {
  const cs = COORDINATE_SYSTEMS.find(c => c.id === settings.coordinate_system_id);

  if (!cs) {
    throw new Error(`Unknown coordinate system: ${settings.coordinate_system_id}`);
  }

  if (!cs.epsg_code) {
    throw new Error('Cannot convert GPS to local coordinates without calibration');
  }

  // Convert GPS to projection
  const projected = gpsToProjection(lat, lng, cs.epsg_code);

  let modelX: number;
  let modelY: number;

  // If model has real coordinates
  if (settings.model_has_real_coordinates) {
    modelX = projected.x;
    modelY = projected.y;
  } else if (settings.transform_matrix) {
    // Apply inverse transformation
    const modelPoint = inverseHelmert(projected, settings.transform_matrix);
    modelX = modelPoint.x;
    modelY = modelPoint.y;
  } else {
    throw new Error('Project not calibrated');
  }

  // Convert meters to model units
  if (settings.model_units === 'millimeters') {
    modelX *= 1000;
    modelY *= 1000;
  } else if (settings.model_units === 'feet') {
    modelX /= 0.3048;
    modelY /= 0.3048;
  }

  return { x: modelX, y: modelY, z: 0 };
}

/**
 * Get conversion factor from model units to meters
 */
export function getModelUnitsToMeters(modelUnits: string): number {
  switch (modelUnits) {
    case 'millimeters':
      return 0.001;
    case 'feet':
      return 0.3048;
    case 'meters':
    default:
      return 1;
  }
}

/**
 * Calculate distance between two GPS points in meters (Haversine formula)
 */
export function gpsDistanceMeters(p1: GPSPoint, p2: GPSPoint): number {
  const R = 6371000; // Earth's radius in meters

  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const deltaLat = (p2.lat - p1.lat) * Math.PI / 180;
  const deltaLng = (p2.lng - p1.lng) * Math.PI / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
