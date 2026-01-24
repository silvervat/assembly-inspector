import * as WorkspaceAPI from 'trimble-connect-workspace-api';

/**
 * Assembly dimension calculation utility
 * Calculates total length and width of an assembly based on sub-component Extrusion Origins
 */

// Line segment type for FreelineMarkup
interface LineSegment {
  start: { positionX: number; positionY: number; positionZ: number };
  end: { positionX: number; positionY: number; positionZ: number };
}

// RGBA Color type
interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Extrusion data extracted from properties
interface ExtrusionData {
  OriginX: number;  // in mm
  OriginY: number;  // in mm
  OriginZ: number;  // in mm
  XDirX: number;
  XDirY: number;
  XDirZ: number;
  ExtrusionX: number;  // in mm
  ExtrusionY: number;  // in mm
  ExtrusionZ: number;  // in mm
}

// Point in 3D space
interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Sub-component with extracted geometry data
interface SubComponentGeometry {
  name: string;
  type: string;
  extrusion: ExtrusionData | null;
  position: Point3D | null;  // Center of gravity
  length?: number;  // from Tekla Quantity
  width?: number;
  height?: number;
}

// Calculated assembly dimensions
export interface AssemblyDimensions {
  totalLength: number;  // mm
  totalWidth: number;   // mm
  totalHeight: number;  // mm
  lengthEndpoints: { start: Point3D; end: Point3D };
  widthEndpoints: { start: Point3D; end: Point3D };
  heightEndpoints: { start: Point3D; end: Point3D };
  subComponentCount: number;
}

// Markup IDs for dimension lines
export interface DimensionMarkupIds {
  lengthLine: number[];
  widthLine: number[];
  heightLine: number[];
  labels: number[];
  all: number[];
}

/**
 * Extract Extrusion data from object properties
 */
export function extractExtrusionData(properties: any[]): ExtrusionData | null {
  if (!properties || !Array.isArray(properties)) return null;

  for (const pset of properties) {
    if (pset.name === 'Extrusion' && pset.properties) {
      const extrusion: Partial<ExtrusionData> = {};
      for (const p of pset.properties) {
        const val = parseFloat(p.value) || 0;
        switch (p.name) {
          case 'OriginX': extrusion.OriginX = val; break;
          case 'OriginY': extrusion.OriginY = val; break;
          case 'OriginZ': extrusion.OriginZ = val; break;
          case 'XDirX': extrusion.XDirX = val; break;
          case 'XDirY': extrusion.XDirY = val; break;
          case 'XDirZ': extrusion.XDirZ = val; break;
          case 'ExtrusionX': extrusion.ExtrusionX = val; break;
          case 'ExtrusionY': extrusion.ExtrusionY = val; break;
          case 'ExtrusionZ': extrusion.ExtrusionZ = val; break;
        }
      }
      if (extrusion.OriginX !== undefined && extrusion.OriginY !== undefined) {
        return extrusion as ExtrusionData;
      }
    }
  }
  return null;
}

/**
 * Extract Tekla Quantity dimensions from properties
 */
export function extractTeklaQuantity(properties: any[]): { length?: number; width?: number; height?: number } {
  if (!properties || !Array.isArray(properties)) return {};

  for (const pset of properties) {
    if ((pset.name === 'Tekla Quantity' || pset.name?.toLowerCase().includes('tekla')) && pset.properties) {
      const result: { length?: number; width?: number; height?: number } = {};
      for (const p of pset.properties) {
        const val = parseFloat(p.value) || 0;
        const name = (p.name || '').toLowerCase();
        if (name === 'length') result.length = val;
        if (name === 'width') result.width = val;
        if (name === 'height') result.height = val;
      }
      return result;
    }
  }
  return {};
}

/**
 * Extract position from CalculatedGeometryValues
 */
export function extractPosition(properties: any[]): Point3D | null {
  if (!properties || !Array.isArray(properties)) return null;

  for (const pset of properties) {
    if (pset.name === 'CalculatedGeometryValues' && pset.properties) {
      let x: number | null = null;
      let y: number | null = null;
      let z: number | null = null;
      for (const p of pset.properties) {
        const val = parseFloat(p.value) || 0;
        if (p.name === 'CenterOfGravityX') x = val;
        if (p.name === 'CenterOfGravityY') y = val;
        if (p.name === 'CenterOfGravityZ') z = val;
      }
      if (x !== null && y !== null && z !== null) {
        return { x, y, z };
      }
    }
  }
  return null;
}

/**
 * Calculate the distance in XY plane only (for horizontal dimensions)
 */
function distanceXY(p1: Point3D, p2: Point3D): number {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
    Math.pow(p1.y - p2.y, 2)
  );
}

/**
 * Calculate assembly dimensions from sub-component Extrusion Origins
 *
 * This finds the extreme points of the assembly by:
 * 1. Collecting all Extrusion Origin points from sub-components
 * 2. Finding the two most distant points (for length)
 * 3. Finding the width perpendicular to the length axis
 */
export function calculateAssemblyDimensions(childProperties: any[]): AssemblyDimensions | null {
  if (!childProperties || childProperties.length === 0) {
    return null;
  }

  // Collect all geometry points from sub-components
  const points: Point3D[] = [];
  const subComponents: SubComponentGeometry[] = [];

  for (const child of childProperties) {
    const props = child?.properties || child?.propertySets || [];
    const name = child?.product?.name || child?.name || 'Unknown';
    const type = child?.product?.description || '';

    const extrusion = extractExtrusionData(props);
    const position = extractPosition(props);
    const teklaQty = extractTeklaQuantity(props);

    const subComp: SubComponentGeometry = {
      name,
      type,
      extrusion,
      position,
      length: teklaQty.length,
      width: teklaQty.width,
      height: teklaQty.height
    };
    subComponents.push(subComp);

    // Add Extrusion Origin as a point (convert from mm to m for internal calculations)
    if (extrusion) {
      points.push({
        x: extrusion.OriginX / 1000,
        y: extrusion.OriginY / 1000,
        z: extrusion.OriginZ / 1000
      });

      // Also add the extrusion end point
      const endPoint: Point3D = {
        x: (extrusion.OriginX + extrusion.ExtrusionX) / 1000,
        y: (extrusion.OriginY + extrusion.ExtrusionY) / 1000,
        z: (extrusion.OriginZ + extrusion.ExtrusionZ) / 1000
      };
      points.push(endPoint);
    } else if (position) {
      // Fallback to center of gravity position (already in m)
      // Position from CalculatedGeometryValues is in mm
      points.push({
        x: position.x / 1000,
        y: position.y / 1000,
        z: position.z / 1000
      });
    }
  }

  if (points.length < 2) {
    return null;
  }

  // Find the two most distant points in XY plane (for length)
  let maxDistXY = 0;
  let lengthStart: Point3D = points[0];
  let lengthEnd: Point3D = points[1];

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = distanceXY(points[i], points[j]);
      if (dist > maxDistXY) {
        maxDistXY = dist;
        lengthStart = points[i];
        lengthEnd = points[j];
      }
    }
  }

  // Calculate length axis direction (in XY plane)
  const lengthDirX = lengthEnd.x - lengthStart.x;
  const lengthDirY = lengthEnd.y - lengthStart.y;
  const lengthMag = Math.sqrt(lengthDirX * lengthDirX + lengthDirY * lengthDirY);
  const lengthNormX = lengthMag > 0 ? lengthDirX / lengthMag : 1;
  const lengthNormY = lengthMag > 0 ? lengthDirY / lengthMag : 0;

  // Width direction is perpendicular to length in XY plane
  const widthNormX = -lengthNormY;
  const widthNormY = lengthNormX;

  // Project all points onto width axis to find width extent
  let minWidthProj = Infinity;
  let maxWidthProj = -Infinity;
  let widthMinPoint: Point3D = points[0];
  let widthMaxPoint: Point3D = points[0];

  // Use length midpoint as reference for width projection
  const lengthMidX = (lengthStart.x + lengthEnd.x) / 2;
  const lengthMidY = (lengthStart.y + lengthEnd.y) / 2;

  for (const p of points) {
    const relX = p.x - lengthMidX;
    const relY = p.y - lengthMidY;
    const proj = relX * widthNormX + relY * widthNormY;
    if (proj < minWidthProj) {
      minWidthProj = proj;
      widthMinPoint = p;
    }
    if (proj > maxWidthProj) {
      maxWidthProj = proj;
      widthMaxPoint = p;
    }
  }

  // Find height extent (Z axis)
  let minZ = Infinity;
  let maxZ = -Infinity;
  let heightMinPoint: Point3D = points[0];
  let heightMaxPoint: Point3D = points[0];

  for (const p of points) {
    if (p.z < minZ) {
      minZ = p.z;
      heightMinPoint = p;
    }
    if (p.z > maxZ) {
      maxZ = p.z;
      heightMaxPoint = p;
    }
  }

  // Calculate dimensions in mm
  const totalLength = maxDistXY * 1000;
  const totalWidth = (maxWidthProj - minWidthProj) * 1000;
  const totalHeight = (maxZ - minZ) * 1000;

  return {
    totalLength,
    totalWidth,
    totalHeight,
    lengthEndpoints: {
      start: { x: lengthStart.x * 1000, y: lengthStart.y * 1000, z: lengthStart.z * 1000 },
      end: { x: lengthEnd.x * 1000, y: lengthEnd.y * 1000, z: lengthEnd.z * 1000 }
    },
    widthEndpoints: {
      start: { x: widthMinPoint.x * 1000, y: widthMinPoint.y * 1000, z: widthMinPoint.z * 1000 },
      end: { x: widthMaxPoint.x * 1000, y: widthMaxPoint.y * 1000, z: widthMaxPoint.z * 1000 }
    },
    heightEndpoints: {
      start: { x: heightMinPoint.x * 1000, y: heightMinPoint.y * 1000, z: heightMinPoint.z * 1000 },
      end: { x: heightMaxPoint.x * 1000, y: heightMaxPoint.y * 1000, z: heightMaxPoint.z * 1000 }
    },
    subComponentCount: subComponents.length
  };
}

/**
 * Draw dimension measurement lines on the model
 */
export async function drawDimensionLines(
  api: WorkspaceAPI.WorkspaceAPI,
  dimensions: AssemblyDimensions
): Promise<DimensionMarkupIds> {
  const markupIds: DimensionMarkupIds = {
    lengthLine: [],
    widthLine: [],
    heightLine: [],
    labels: [],
    all: []
  };

  const markupApi = api.markup as any;

  // Colors for dimension lines
  const lengthColor: RGBAColor = { r: 255, g: 0, b: 0, a: 255 };      // Red for length
  const widthColor: RGBAColor = { r: 0, g: 128, b: 255, a: 255 };     // Blue for width
  const heightColor: RGBAColor = { r: 0, g: 200, b: 0, a: 255 };      // Green for height

  // Offset for dimension lines from actual geometry
  const offset = 200; // mm

  try {
    // === LENGTH DIMENSION LINE ===
    const ls = dimensions.lengthEndpoints.start;
    const le = dimensions.lengthEndpoints.end;

    // Calculate perpendicular offset direction (in XY plane)
    const lDirX = le.x - ls.x;
    const lDirY = le.y - ls.y;
    const lMag = Math.sqrt(lDirX * lDirX + lDirY * lDirY);
    const lPerpX = lMag > 0 ? -lDirY / lMag : 0;
    const lPerpY = lMag > 0 ? lDirX / lMag : 1;

    // Offset the dimension line
    const lOffsetZ = ls.z + offset;
    const lengthLines: LineSegment[] = [
      // Main dimension line
      {
        start: { positionX: ls.x + lPerpX * offset, positionY: ls.y + lPerpY * offset, positionZ: lOffsetZ },
        end: { positionX: le.x + lPerpX * offset, positionY: le.y + lPerpY * offset, positionZ: lOffsetZ }
      },
      // Start extension line
      {
        start: { positionX: ls.x, positionY: ls.y, positionZ: ls.z },
        end: { positionX: ls.x + lPerpX * offset * 1.2, positionY: ls.y + lPerpY * offset * 1.2, positionZ: lOffsetZ }
      },
      // End extension line
      {
        start: { positionX: le.x, positionY: le.y, positionZ: le.z },
        end: { positionX: le.x + lPerpX * offset * 1.2, positionY: le.y + lPerpY * offset * 1.2, positionZ: lOffsetZ }
      },
      // Start arrow tick
      {
        start: { positionX: ls.x + lPerpX * (offset - 50), positionY: ls.y + lPerpY * (offset - 50), positionZ: lOffsetZ },
        end: { positionX: ls.x + lPerpX * (offset + 50), positionY: ls.y + lPerpY * (offset + 50), positionZ: lOffsetZ }
      },
      // End arrow tick
      {
        start: { positionX: le.x + lPerpX * (offset - 50), positionY: le.y + lPerpY * (offset - 50), positionZ: lOffsetZ },
        end: { positionX: le.x + lPerpX * (offset + 50), positionY: le.y + lPerpY * (offset + 50), positionZ: lOffsetZ }
      }
    ];

    const lengthMarkup = await markupApi.addFreelineMarkups?.([{
      color: lengthColor,
      lines: lengthLines
    }]);
    if (lengthMarkup?.[0]?.id) {
      markupIds.lengthLine.push(lengthMarkup[0].id);
      markupIds.all.push(lengthMarkup[0].id);
    }

    // Length label
    const lengthMidX = (ls.x + le.x) / 2 + lPerpX * offset;
    const lengthMidY = (ls.y + le.y) / 2 + lPerpY * offset;
    const lengthText = `${Math.round(dimensions.totalLength)} mm`;

    const lengthLabel = await markupApi.addTextMarkup?.([{
      text: lengthText,
      start: {
        positionX: lengthMidX,
        positionY: lengthMidY,
        positionZ: lOffsetZ + 100
      },
      end: {
        positionX: lengthMidX + 200,
        positionY: lengthMidY + 100,
        positionZ: lOffsetZ + 100
      },
      color: lengthColor
    }]);
    if (lengthLabel?.[0]?.id) {
      markupIds.labels.push(lengthLabel[0].id);
      markupIds.all.push(lengthLabel[0].id);
    }

    // === WIDTH DIMENSION LINE (only if width > 0) ===
    if (dimensions.totalWidth > 10) {
      const ws = dimensions.widthEndpoints.start;
      const we = dimensions.widthEndpoints.end;

      // Calculate perpendicular to width direction
      const wDirX = we.x - ws.x;
      const wDirY = we.y - ws.y;
      const wMag = Math.sqrt(wDirX * wDirX + wDirY * wDirY);
      const wPerpX = wMag > 0 ? -wDirY / wMag : 0;
      const wPerpY = wMag > 0 ? wDirX / wMag : 1;

      const wOffsetZ = ws.z + offset * 2;
      const widthLines: LineSegment[] = [
        // Main dimension line
        {
          start: { positionX: ws.x + wPerpX * offset, positionY: ws.y + wPerpY * offset, positionZ: wOffsetZ },
          end: { positionX: we.x + wPerpX * offset, positionY: we.y + wPerpY * offset, positionZ: wOffsetZ }
        },
        // Start extension line
        {
          start: { positionX: ws.x, positionY: ws.y, positionZ: ws.z },
          end: { positionX: ws.x + wPerpX * offset * 1.2, positionY: ws.y + wPerpY * offset * 1.2, positionZ: wOffsetZ }
        },
        // End extension line
        {
          start: { positionX: we.x, positionY: we.y, positionZ: we.z },
          end: { positionX: we.x + wPerpX * offset * 1.2, positionY: we.y + wPerpY * offset * 1.2, positionZ: wOffsetZ }
        }
      ];

      const widthMarkup = await markupApi.addFreelineMarkups?.([{
        color: widthColor,
        lines: widthLines
      }]);
      if (widthMarkup?.[0]?.id) {
        markupIds.widthLine.push(widthMarkup[0].id);
        markupIds.all.push(widthMarkup[0].id);
      }

      // Width label
      const widthMidX = (ws.x + we.x) / 2 + wPerpX * offset;
      const widthMidY = (ws.y + we.y) / 2 + wPerpY * offset;
      const widthText = `${Math.round(dimensions.totalWidth)} mm`;

      const widthLabel = await markupApi.addTextMarkup?.([{
        text: widthText,
        start: {
          positionX: widthMidX,
          positionY: widthMidY,
          positionZ: wOffsetZ + 100
        },
        end: {
          positionX: widthMidX + 200,
          positionY: widthMidY + 100,
          positionZ: wOffsetZ + 100
        },
        color: widthColor
      }]);
      if (widthLabel?.[0]?.id) {
        markupIds.labels.push(widthLabel[0].id);
        markupIds.all.push(widthLabel[0].id);
      }
    }

    // === HEIGHT DIMENSION LINE (only if height > 0) ===
    if (dimensions.totalHeight > 10) {
      const hs = dimensions.heightEndpoints.start;
      const he = dimensions.heightEndpoints.end;

      const heightLines: LineSegment[] = [
        // Vertical main line
        {
          start: { positionX: hs.x + offset, positionY: hs.y, positionZ: hs.z },
          end: { positionX: he.x + offset, positionY: he.y, positionZ: he.z }
        },
        // Bottom extension
        {
          start: { positionX: hs.x, positionY: hs.y, positionZ: hs.z },
          end: { positionX: hs.x + offset * 1.2, positionY: hs.y, positionZ: hs.z }
        },
        // Top extension
        {
          start: { positionX: he.x, positionY: he.y, positionZ: he.z },
          end: { positionX: he.x + offset * 1.2, positionY: he.y, positionZ: he.z }
        }
      ];

      const heightMarkup = await markupApi.addFreelineMarkups?.([{
        color: heightColor,
        lines: heightLines
      }]);
      if (heightMarkup?.[0]?.id) {
        markupIds.heightLine.push(heightMarkup[0].id);
        markupIds.all.push(heightMarkup[0].id);
      }

      // Height label
      const heightMidZ = (hs.z + he.z) / 2;
      const heightText = `${Math.round(dimensions.totalHeight)} mm`;

      const heightLabel = await markupApi.addTextMarkup?.([{
        text: heightText,
        start: {
          positionX: hs.x + offset + 100,
          positionY: hs.y,
          positionZ: heightMidZ
        },
        end: {
          positionX: hs.x + offset + 300,
          positionY: hs.y + 100,
          positionZ: heightMidZ + 100
        },
        color: heightColor
      }]);
      if (heightLabel?.[0]?.id) {
        markupIds.labels.push(heightLabel[0].id);
        markupIds.all.push(heightLabel[0].id);
      }
    }

  } catch (error) {
    console.error('[AssemblyDimensions] Error drawing dimension lines:', error);
  }

  return markupIds;
}

/**
 * Remove dimension markup lines from the model
 */
export async function removeDimensionLines(
  api: WorkspaceAPI.WorkspaceAPI,
  markupIds: number[]
): Promise<void> {
  if (markupIds.length === 0) return;

  try {
    // Remove in chunks to avoid timeout
    const CHUNK_SIZE = 50;
    for (let i = 0; i < markupIds.length; i += CHUNK_SIZE) {
      const chunk = markupIds.slice(i, i + CHUNK_SIZE);
      await api.markup.removeMarkups(chunk);
      if (i + CHUNK_SIZE < markupIds.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  } catch (error) {
    console.error('[AssemblyDimensions] Error removing markups:', error);
  }
}

/**
 * Format dimensions as a readable string
 */
export function formatDimensions(dimensions: AssemblyDimensions): string {
  const length = Math.round(dimensions.totalLength);
  const width = Math.round(dimensions.totalWidth);
  const height = Math.round(dimensions.totalHeight);

  let result = `📏 ASSEMBLY MÕÕTMED\n${'═'.repeat(30)}\n\n`;
  result += `📐 Pikkus: ${length} mm\n`;
  if (width > 10) {
    result += `📐 Laius: ${width} mm\n`;
  }
  if (height > 10) {
    result += `📐 Kõrgus: ${height} mm\n`;
  }
  result += `\n🧩 Alamdetaile: ${dimensions.subComponentCount} tk`;

  return result;
}
