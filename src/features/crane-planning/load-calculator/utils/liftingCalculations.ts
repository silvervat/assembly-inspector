import { LoadChartDataPoint, LoadCalculationResult } from '../../../../supabase';

/**
 * Calculate available lifting capacity at various radii
 */
export function calculateLoadCapacities(
  chartData: LoadChartDataPoint[],
  hookWeightKg: number,
  liftingBlockKg: number,
  safetyFactor: number
): LoadCalculationResult[] {
  if (!chartData || chartData.length === 0) return [];

  const deadWeight = hookWeightKg + liftingBlockKg;

  return chartData.map(point => {
    const grossCapacity = point.capacity_kg;
    const availableCapacity = (grossCapacity - deadWeight) / safetyFactor;

    return {
      radius_m: point.radius_m,
      max_capacity_kg: grossCapacity,
      available_capacity_kg: Math.max(0, Math.round(availableCapacity)),
      is_safe: availableCapacity > 0
    };
  });
}

/**
 * Get capacity at a specific radius using linear interpolation
 */
export function getCapacityAtRadius(
  chartData: LoadChartDataPoint[],
  radius: number
): number | null {
  if (!chartData || chartData.length === 0) return null;

  // Sort by radius
  const sortedData = [...chartData].sort((a, b) => a.radius_m - b.radius_m);

  // Find exact match
  const exactMatch = sortedData.find(d => d.radius_m === radius);
  if (exactMatch) {
    return exactMatch.capacity_kg;
  }

  // Find surrounding points for interpolation
  let prevPoint: LoadChartDataPoint | null = null;
  let nextPoint: LoadChartDataPoint | null = null;

  for (const point of sortedData) {
    if (point.radius_m < radius) {
      prevPoint = point;
    } else if (point.radius_m > radius && !nextPoint) {
      nextPoint = point;
      break;
    }
  }

  // Linear interpolation
  if (prevPoint && nextPoint) {
    const ratio = (radius - prevPoint.radius_m) / (nextPoint.radius_m - prevPoint.radius_m);
    const capacity = prevPoint.capacity_kg + ratio * (nextPoint.capacity_kg - prevPoint.capacity_kg);
    return Math.round(capacity);
  }

  // Return closest point if no interpolation possible
  if (prevPoint) return prevPoint.capacity_kg;
  if (nextPoint) return nextPoint.capacity_kg;

  return null;
}

/**
 * Calculate available capacity at a specific radius
 */
export function calculateAvailableCapacity(
  chartData: LoadChartDataPoint[],
  radius: number,
  hookWeightKg: number,
  liftingBlockKg: number,
  safetyFactor: number
): LoadCalculationResult | null {
  const grossCapacity = getCapacityAtRadius(chartData, radius);
  if (grossCapacity === null) return null;

  const deadWeight = hookWeightKg + liftingBlockKg;
  const availableCapacity = (grossCapacity - deadWeight) / safetyFactor;

  return {
    radius_m: radius,
    max_capacity_kg: grossCapacity,
    available_capacity_kg: Math.max(0, Math.round(availableCapacity)),
    is_safe: availableCapacity > 0
  };
}

/**
 * Find the maximum radius at which a given load can be lifted
 */
export function findMaxRadiusForLoad(
  chartData: LoadChartDataPoint[],
  loadKg: number,
  hookWeightKg: number,
  liftingBlockKg: number,
  safetyFactor: number
): number | null {
  if (!chartData || chartData.length === 0) return null;

  const deadWeight = hookWeightKg + liftingBlockKg;
  const requiredCapacity = (loadKg + deadWeight) * safetyFactor;

  // Sort by radius descending
  const sortedData = [...chartData].sort((a, b) => b.radius_m - a.radius_m);

  // Find the largest radius where capacity is sufficient
  for (const point of sortedData) {
    if (point.capacity_kg >= requiredCapacity) {
      return point.radius_m;
    }
  }

  return null;
}

/**
 * Check if a load can be safely lifted at a given radius
 */
export function canLiftLoad(
  chartData: LoadChartDataPoint[],
  radius: number,
  loadKg: number,
  hookWeightKg: number,
  liftingBlockKg: number,
  safetyFactor: number
): boolean {
  const result = calculateAvailableCapacity(
    chartData,
    radius,
    hookWeightKg,
    liftingBlockKg,
    safetyFactor
  );

  return result !== null && result.available_capacity_kg >= loadKg;
}

/**
 * Calculate utilization percentage
 */
export function calculateUtilization(
  chartData: LoadChartDataPoint[],
  radius: number,
  loadKg: number,
  hookWeightKg: number,
  liftingBlockKg: number
): number | null {
  const grossCapacity = getCapacityAtRadius(chartData, radius);
  if (grossCapacity === null || grossCapacity === 0) return null;

  const deadWeight = hookWeightKg + liftingBlockKg;
  const totalLoad = loadKg + deadWeight;

  return Math.round((totalLoad / grossCapacity) * 100);
}

/**
 * Format weight for display
 */
export function formatWeight(kg: number, decimals: number = 1): string {
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(decimals)}t`;
  }
  return `${kg.toFixed(0)}kg`;
}

/**
 * Parse load chart data from Excel paste (tab or comma separated)
 */
export function parseLoadChartFromPaste(text: string): LoadChartDataPoint[] {
  const rows = text.split('\n').filter(r => r.trim());
  const parsed: LoadChartDataPoint[] = [];

  for (const row of rows) {
    // Split by tab, comma, or semicolon
    const [radiusStr, capacityStr] = row.split(/[\t,;]/);

    if (!radiusStr || !capacityStr) continue;

    const radius_m = parseFloat(radiusStr.trim().replace(',', '.'));
    let capacity_kg = parseFloat(capacityStr.trim().replace(',', '.'));

    // If capacity looks like tonnes (less than 1000), convert to kg
    if (capacity_kg < 1000) {
      capacity_kg = capacity_kg * 1000;
    }

    if (!isNaN(radius_m) && !isNaN(capacity_kg)) {
      parsed.push({ radius_m, capacity_kg });
    }
  }

  // Sort by radius
  return parsed.sort((a, b) => a.radius_m - b.radius_m);
}
