import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { ProjectCrane, CraneModel, CraneRGBAColor, LoadChartDataPoint } from '../../../../supabase';

// Line segment type for FreelineMarkup
interface LineSegment {
  start: { positionX: number; positionY: number; positionZ: number };
  end: { positionX: number; positionY: number; positionZ: number };
}

/**
 * Draw a complete crane visualization in the model
 * Detailed top-view showing: chassis, outriggers with pads, boom, cabin, center point
 * OPTIMIZED: Each separate shape is one freeline call to avoid line connections
 */
export async function drawCraneToModel(
  api: WorkspaceAPI.WorkspaceAPI,
  projectCrane: ProjectCrane,
  craneModel: CraneModel,
  loadChartData?: LoadChartDataPoint[]
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;

  // Convert meters to millimeters for Trimble API
  const posX = projectCrane.position_x * 1000;
  const posY = projectCrane.position_y * 1000;
  const posZ = projectCrane.position_z * 1000;

  const rotationRad = (projectCrane.rotation_deg * Math.PI) / 180;

  // Crane dimensions in mm
  const baseWidthMm = craneModel.base_width_m * 1000;
  const baseLengthMm = craneModel.base_length_m * 1000;

  // Calculate outrigger span (typically 1.8x base width for mobile cranes)
  const outriggerSpanMm = baseWidthMm * 1.8;
  const outriggerPadSizeMm = 600; // 600mm square pad

  console.log('[CraneViz] Drawing detailed crane:', {
    position: { x: projectCrane.position_x, y: projectCrane.position_y, z: projectCrane.position_z },
    rotation: projectCrane.rotation_deg,
    craneModel: craneModel.manufacturer + ' ' + craneModel.model,
    base: { width: craneModel.base_width_m, length: craneModel.base_length_m },
    outriggerSpan: outriggerSpanMm / 1000
  });

  // Helper function to rotate and translate a point
  const transformPoint = (localX: number, localY: number): { x: number; y: number } => {
    const rotatedX = localX * Math.cos(rotationRad) - localY * Math.sin(rotationRad);
    const rotatedY = localX * Math.sin(rotationRad) + localY * Math.cos(rotationRad);
    return { x: posX + rotatedX, y: posY + rotatedY };
  };

  // Helper to create line segment
  const seg = (p1: {x: number, y: number}, p2: {x: number, y: number}, z: number): LineSegment => ({
    start: { positionX: p1.x, positionY: p1.y, positionZ: z },
    end: { positionX: p2.x, positionY: p2.y, positionZ: z }
  });

  // Helper to draw connected polygon (returns segments for closed shape)
  const createPolygon = (corners: {x: number, y: number}[], z: number): LineSegment[] => {
    const segments: LineSegment[] = [];
    for (let i = 0; i < corners.length; i++) {
      const next = (i + 1) % corners.length;
      segments.push(seg(corners[i], corners[next], z));
    }
    return segments;
  };

  const craneColor = projectCrane.crane_color;

  try {
    // Collect all freeline entries - each separate shape is one entry
    const freelineEntries: { color: CraneRGBAColor; lines: LineSegment[] }[] = [];

    // === 1. MAIN CHASSIS (rectangle - connected shape) ===
    const halfWidth = baseWidthMm / 2;
    const halfLength = baseLengthMm / 2;
    const chassisCorners = [
      transformPoint(-halfWidth, -halfLength),
      transformPoint(halfWidth, -halfLength),
      transformPoint(halfWidth, halfLength),
      transformPoint(-halfWidth, halfLength)
    ];
    freelineEntries.push({ color: craneColor, lines: createPolygon(chassisCorners, posZ) });

    // === 2. OUTRIGGERS with SUPPORT PADS (each outrigger separate) ===
    const outriggerPositions = [
      { cornerX: -halfWidth, cornerY: -halfLength, padX: -outriggerSpanMm / 2, padY: -outriggerSpanMm / 2 },
      { cornerX: halfWidth, cornerY: -halfLength, padX: outriggerSpanMm / 2, padY: -outriggerSpanMm / 2 },
      { cornerX: halfWidth, cornerY: halfLength, padX: outriggerSpanMm / 2, padY: outriggerSpanMm / 2 },
      { cornerX: -halfWidth, cornerY: halfLength, padX: -outriggerSpanMm / 2, padY: outriggerSpanMm / 2 }
    ];

    for (const outrigger of outriggerPositions) {
      const corner = transformPoint(outrigger.cornerX, outrigger.cornerY);
      const padCenter = transformPoint(outrigger.padX, outrigger.padY);

      // Outrigger beam (single line)
      freelineEntries.push({ color: craneColor, lines: [seg(corner, padCenter, posZ)] });

      // Support pad (connected rectangle)
      const padHalf = outriggerPadSizeMm / 2;
      const padCorners = [
        transformPoint(outrigger.padX - padHalf, outrigger.padY - padHalf),
        transformPoint(outrigger.padX + padHalf, outrigger.padY - padHalf),
        transformPoint(outrigger.padX + padHalf, outrigger.padY + padHalf),
        transformPoint(outrigger.padX - padHalf, outrigger.padY + padHalf)
      ];
      freelineEntries.push({ color: craneColor, lines: createPolygon(padCorners, posZ) });
    }

    // === 3. CENTER TURNTABLE (circle - connected) ===
    const turntableRadius = Math.min(baseWidthMm, baseLengthMm) * 0.3;
    const turntableSegments: LineSegment[] = [];
    const numTurntableSegs = 24;
    for (let i = 0; i < numTurntableSegs; i++) {
      const angle1 = (i / numTurntableSegs) * 2 * Math.PI;
      const angle2 = ((i + 1) / numTurntableSegs) * 2 * Math.PI;
      const p1 = transformPoint(turntableRadius * Math.cos(angle1), turntableRadius * Math.sin(angle1));
      const p2 = transformPoint(turntableRadius * Math.cos(angle2), turntableRadius * Math.sin(angle2));
      turntableSegments.push(seg(p1, p2, posZ + 100));
    }
    freelineEntries.push({ color: craneColor, lines: turntableSegments });

    // === 4. BOOM (trapezoid outline - connected, centerline - separate) ===
    const boomLength = baseLengthMm * 0.7;
    const boomBaseWidth = baseWidthMm * 0.25;
    const boomTipWidth = baseWidthMm * 0.1;
    const boomCorners = [
      transformPoint(-boomBaseWidth / 2, 0),
      transformPoint(-boomTipWidth / 2, halfLength + boomLength * 0.3),
      transformPoint(boomTipWidth / 2, halfLength + boomLength * 0.3),
      transformPoint(boomBaseWidth / 2, 0)
    ];
    freelineEntries.push({ color: craneColor, lines: createPolygon(boomCorners, posZ + 200) });

    // Boom centerline (separate line)
    const boomStart = transformPoint(0, 0);
    const boomEnd = transformPoint(0, halfLength + boomLength * 0.3);
    freelineEntries.push({ color: craneColor, lines: [seg(boomStart, boomEnd, posZ + 200)] });

    // === 5. CABIN (rectangle - connected) ===
    const cabinWidth = baseWidthMm * 0.3;
    const cabinLength = baseLengthMm * 0.2;
    let cabinCenterX = 0, cabinCenterY = 0;
    switch (craneModel.cab_position) {
      case 'front': cabinCenterY = halfLength - cabinLength / 2 - 100; break;
      case 'rear': cabinCenterY = -halfLength + cabinLength / 2 + 100; break;
      case 'left': cabinCenterX = -halfWidth + cabinWidth / 2 + 100; break;
      case 'right': cabinCenterX = halfWidth - cabinWidth / 2 - 100; break;
      default: cabinCenterY = -halfLength + cabinLength / 2 + 100;
    }
    const cabinCorners = [
      transformPoint(cabinCenterX - cabinWidth / 2, cabinCenterY - cabinLength / 2),
      transformPoint(cabinCenterX + cabinWidth / 2, cabinCenterY - cabinLength / 2),
      transformPoint(cabinCenterX + cabinWidth / 2, cabinCenterY + cabinLength / 2),
      transformPoint(cabinCenterX - cabinWidth / 2, cabinCenterY + cabinLength / 2)
    ];
    freelineEntries.push({ color: craneColor, lines: createPolygon(cabinCorners, posZ + 50) });

    // === 6. CENTER CROSS (two separate lines) ===
    const crossSize = 500;
    const cross1 = transformPoint(-crossSize, 0);
    const cross2 = transformPoint(crossSize, 0);
    const cross3 = transformPoint(0, -crossSize);
    const cross4 = transformPoint(0, crossSize);
    freelineEntries.push({ color: craneColor, lines: [seg(cross1, cross2, posZ + 300)] });
    freelineEntries.push({ color: craneColor, lines: [seg(cross3, cross4, posZ + 300)] });

    // Draw all crane shapes in ONE batch call (but each entry is separate)
    console.log('[CraneViz] Drawing', freelineEntries.length, 'crane shapes');
    const craneMarkups = await markupApi.addFreelineMarkups?.(freelineEntries);
    if (craneMarkups) {
      craneMarkups.forEach((m: any) => {
        if (m?.id) markupIds.push(m.id);
      });
    }

    // === 7. RADIUS RINGS (if enabled) ===
    if (projectCrane.show_radius_rings) {
      console.log('[CraneViz] Drawing radius rings...');
      const radiusMarkups = await drawRadiusRings(
        api,
        posX,
        posY,
        posZ,
        projectCrane.radius_step_m,
        craneModel.max_radius_m,
        projectCrane.radius_color,
        projectCrane.show_capacity_labels,
        loadChartData,
        projectCrane.max_radius_limit_m,
        projectCrane.label_color,
        projectCrane.label_height_mm
      );
      markupIds.push(...radiusMarkups);
      console.log('[CraneViz] Radius markups count:', radiusMarkups.length);
    }

    // === 8. POSITION LABEL (if set) ===
    if (projectCrane.position_label) {
      const labelText = projectCrane.position_label;
      const labelHeight = projectCrane.label_height_mm || 800;
      const labelColor = projectCrane.label_color || { r: 50, g: 50, b: 50, a: 255 };

      console.log('[CraneViz] Drawing position label:', labelText);

      // Position label next to the crane (offset from outrigger span)
      const labelOffsetX = outriggerSpanMm / 2 + labelHeight + 500;
      const labelPos = transformPoint(labelOffsetX, 0);

      const labelMarkups = await drawText3D(
        markupApi,
        labelText,
        labelPos.x,
        labelPos.y,
        posZ + 200,
        labelHeight,
        labelColor
      );
      markupIds.push(...labelMarkups);
    }

    console.log('[CraneViz] Total markups created:', markupIds.length);
    return markupIds;
  } catch (error) {
    console.error('[CraneViz] Error drawing crane to model:', error);
    return markupIds;
  }
}

/**
 * Draw 3D text with each character as separate freeline (avoids line connections)
 * OPTIMIZED: All characters drawn in one batch call
 */
async function drawText3D(
  markupApi: any,
  text: string,
  startX: number,
  startY: number,
  startZ: number,
  heightMm: number,
  color: CraneRGBAColor
): Promise<number[]> {
  const markupIds: number[] = [];
  const spacing = heightMm * 0.2;
  let currentX = startX;

  // Collect all character entries for batch call
  const charEntries: { color: CraneRGBAColor; lines: LineSegment[] }[] = [];

  for (const char of text.toLowerCase()) {
    const charDef = LINE_FONT[char];
    if (!charDef) continue;

    const charWidth = charDef.width * heightMm;

    // Generate line segments for this character
    const charSegments: LineSegment[] = [];
    for (const [x1, y1, x2, y2] of charDef.lines) {
      charSegments.push({
        start: {
          positionX: currentX + x1 * heightMm,
          positionY: startY + y1 * heightMm,
          positionZ: startZ
        },
        end: {
          positionX: currentX + x2 * heightMm,
          positionY: startY + y2 * heightMm,
          positionZ: startZ
        }
      });
    }

    if (charSegments.length > 0) {
      charEntries.push({ color, lines: charSegments });
    }

    currentX += charWidth + spacing;
  }

  // Draw all characters in ONE batch call
  if (charEntries.length > 0) {
    const charMarkups = await markupApi.addFreelineMarkups?.(charEntries);
    if (charMarkups) {
      charMarkups.forEach((m: any) => {
        if (m?.id) markupIds.push(m.id);
      });
    }
  }

  return markupIds;
}

/**
 * Generate circle line segments with {start, end} pairs
 */
function generateCircleSegments(
  centerX: number,
  centerY: number,
  centerZ: number,
  radiusMm: number,
  segments: number
): LineSegment[] {
  const lineSegments: LineSegment[] = [];

  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * 2 * Math.PI;
    const angle2 = ((i + 1) / segments) * 2 * Math.PI;

    lineSegments.push({
      start: {
        positionX: centerX + radiusMm * Math.cos(angle1),
        positionY: centerY + radiusMm * Math.sin(angle1),
        positionZ: centerZ
      },
      end: {
        positionX: centerX + radiusMm * Math.cos(angle2),
        positionY: centerY + radiusMm * Math.sin(angle2),
        positionZ: centerZ
      }
    });
  }

  return lineSegments;
}

/**
 * Generate dotted/dashed circle line segments
 * Creates a circle with gaps to simulate a dotted line effect
 */
function generateDottedCircleSegments(
  centerX: number,
  centerY: number,
  centerZ: number,
  radiusMm: number,
  dashCount: number = 36, // Number of dashes
  dashRatio: number = 0.6 // Ratio of dash to gap (0.6 = 60% dash, 40% gap)
): LineSegment[] {
  const lineSegments: LineSegment[] = [];
  const segmentAngle = (2 * Math.PI) / dashCount;
  const dashAngle = segmentAngle * dashRatio;

  for (let i = 0; i < dashCount; i++) {
    const startAngle = i * segmentAngle;
    const endAngle = startAngle + dashAngle;

    lineSegments.push({
      start: {
        positionX: centerX + radiusMm * Math.cos(startAngle),
        positionY: centerY + radiusMm * Math.sin(startAngle),
        positionZ: centerZ
      },
      end: {
        positionX: centerX + radiusMm * Math.cos(endAngle),
        positionY: centerY + radiusMm * Math.sin(endAngle),
        positionZ: centerZ
      }
    });
  }

  return lineSegments;
}

/**
 * Simple line-based font for 3D text rendering (top-view readable)
 * Returns line segments for each character (normalized 0-1 coordinate space)
 * Height is 1.0, width varies per character
 * Lines are defined as [x1, y1, x2, y2] where text extends in X direction (width) and Y direction (height)
 */
const LINE_FONT: Record<string, { width: number; lines: [number, number, number, number][] }> = {
  // Numbers
  '0': { width: 0.6, lines: [[0, 0, 0.6, 0], [0.6, 0, 0.6, 1], [0.6, 1, 0, 1], [0, 1, 0, 0]] },
  '1': { width: 0.4, lines: [[0.2, 0, 0.2, 1], [0, 0.8, 0.2, 1], [0, 0, 0.4, 0]] },
  '2': { width: 0.6, lines: [[0, 1, 0.6, 1], [0.6, 1, 0.6, 0.5], [0.6, 0.5, 0, 0.5], [0, 0.5, 0, 0], [0, 0, 0.6, 0]] },
  '3': { width: 0.6, lines: [[0, 1, 0.6, 1], [0.6, 1, 0.6, 0], [0.6, 0, 0, 0], [0.2, 0.5, 0.6, 0.5]] },
  '4': { width: 0.6, lines: [[0, 1, 0, 0.4], [0, 0.4, 0.6, 0.4], [0.5, 1, 0.5, 0]] },
  '5': { width: 0.6, lines: [[0.6, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.6, 0.4], [0.6, 0.4, 0.6, 0.1], [0.6, 0.1, 0.5, 0], [0.5, 0, 0, 0]] },
  '6': { width: 0.6, lines: [[0.5, 1, 0.1, 1], [0.1, 1, 0, 0.8], [0, 0.8, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.5, 0], [0.5, 0, 0.6, 0.1], [0.6, 0.1, 0.6, 0.4], [0.6, 0.4, 0.5, 0.5], [0.5, 0.5, 0, 0.5]] },
  '7': { width: 0.6, lines: [[0, 1, 0.6, 1], [0.6, 1, 0.2, 0]] },
  '8': { width: 0.6, lines: [[0.1, 0, 0.5, 0], [0.5, 0, 0.6, 0.1], [0.6, 0.1, 0.6, 0.4], [0.6, 0.4, 0.5, 0.5], [0.5, 0.5, 0.6, 0.6], [0.6, 0.6, 0.6, 0.9], [0.6, 0.9, 0.5, 1], [0.5, 1, 0.1, 1], [0.1, 1, 0, 0.9], [0, 0.9, 0, 0.6], [0, 0.6, 0.1, 0.5], [0.1, 0.5, 0, 0.4], [0, 0.4, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0.5, 0.5, 0.5]] },
  '9': { width: 0.6, lines: [[0.6, 0.5, 0, 0.5], [0, 0.5, 0, 0.9], [0, 0.9, 0.1, 1], [0.1, 1, 0.5, 1], [0.5, 1, 0.6, 0.9], [0.6, 0.9, 0.6, 0.1], [0.6, 0.1, 0.5, 0], [0.5, 0, 0.1, 0]] },
  // Letters
  'a': { width: 0.6, lines: [[0, 0, 0, 0.4], [0, 0.4, 0.5, 0.4], [0.5, 0.4, 0.6, 0.3], [0.6, 0.3, 0.6, 0], [0.6, 0.2, 0, 0.2], [0, 0, 0.5, 0], [0.5, 0, 0.6, 0.1]] },
  'b': { width: 0.6, lines: [[0, 0, 0, 1], [0, 0.4, 0.5, 0.4], [0.5, 0.4, 0.6, 0.3], [0.6, 0.3, 0.6, 0.1], [0.6, 0.1, 0.5, 0], [0.5, 0, 0, 0]] },
  'c': { width: 0.5, lines: [[0.5, 0.4, 0.2, 0.4], [0.2, 0.4, 0, 0.3], [0, 0.3, 0, 0.1], [0, 0.1, 0.2, 0], [0.2, 0, 0.5, 0]] },
  'd': { width: 0.6, lines: [[0.6, 0, 0.6, 1], [0.6, 0.4, 0.1, 0.4], [0.1, 0.4, 0, 0.3], [0, 0.3, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.6, 0]] },
  'e': { width: 0.5, lines: [[0.5, 0, 0.1, 0], [0.1, 0, 0, 0.1], [0, 0.1, 0, 0.3], [0, 0.3, 0.1, 0.4], [0.1, 0.4, 0.5, 0.4], [0, 0.2, 0.5, 0.2]] },
  'f': { width: 0.4, lines: [[0.1, 0, 0.1, 0.8], [0.1, 0.8, 0.2, 1], [0.2, 1, 0.4, 1], [0, 0.5, 0.3, 0.5]] },
  'g': { width: 0.6, lines: [[0.6, 0.4, 0.1, 0.4], [0.1, 0.4, 0, 0.3], [0, 0.3, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.6, 0], [0.6, 0.4, 0.6, -0.2], [0.6, -0.2, 0.5, -0.3], [0.5, -0.3, 0, -0.3]] },
  'h': { width: 0.6, lines: [[0, 0, 0, 1], [0, 0.4, 0.5, 0.4], [0.5, 0.4, 0.6, 0.3], [0.6, 0.3, 0.6, 0]] },
  'i': { width: 0.2, lines: [[0.1, 0, 0.1, 0.4], [0.1, 0.55, 0.1, 0.65]] },
  'j': { width: 0.3, lines: [[0.2, 0.4, 0.2, -0.1], [0.2, -0.1, 0.1, -0.2], [0.1, -0.2, 0, -0.2], [0.2, 0.55, 0.2, 0.65]] },
  'k': { width: 0.5, lines: [[0, 0, 0, 1], [0, 0.2, 0.5, 0.4], [0.2, 0.28, 0.5, 0]] },
  'l': { width: 0.2, lines: [[0.1, 0, 0.1, 1]] },
  'm': { width: 0.9, lines: [[0, 0, 0, 0.4], [0, 0.4, 0.3, 0.4], [0.3, 0.4, 0.4, 0.3], [0.4, 0.3, 0.4, 0], [0.4, 0.4, 0.7, 0.4], [0.7, 0.4, 0.8, 0.3], [0.8, 0.3, 0.8, 0]] },
  'n': { width: 0.6, lines: [[0, 0, 0, 0.4], [0, 0.4, 0.5, 0.4], [0.5, 0.4, 0.6, 0.3], [0.6, 0.3, 0.6, 0]] },
  'o': { width: 0.6, lines: [[0.1, 0, 0.5, 0], [0.5, 0, 0.6, 0.1], [0.6, 0.1, 0.6, 0.3], [0.6, 0.3, 0.5, 0.4], [0.5, 0.4, 0.1, 0.4], [0.1, 0.4, 0, 0.3], [0, 0.3, 0, 0.1], [0, 0.1, 0.1, 0]] },
  'p': { width: 0.6, lines: [[0, -0.3, 0, 0.4], [0, 0.4, 0.5, 0.4], [0.5, 0.4, 0.6, 0.3], [0.6, 0.3, 0.6, 0.1], [0.6, 0.1, 0.5, 0], [0.5, 0, 0, 0]] },
  'q': { width: 0.6, lines: [[0.6, -0.3, 0.6, 0.4], [0.6, 0.4, 0.1, 0.4], [0.1, 0.4, 0, 0.3], [0, 0.3, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.6, 0]] },
  'r': { width: 0.4, lines: [[0, 0, 0, 0.4], [0, 0.3, 0.2, 0.4], [0.2, 0.4, 0.4, 0.4]] },
  's': { width: 0.5, lines: [[0.5, 0.4, 0.1, 0.4], [0.1, 0.4, 0, 0.35], [0, 0.35, 0, 0.25], [0, 0.25, 0.1, 0.2], [0.1, 0.2, 0.4, 0.2], [0.4, 0.2, 0.5, 0.15], [0.5, 0.15, 0.5, 0.05], [0.5, 0.05, 0.4, 0], [0.4, 0, 0, 0]] },
  't': { width: 0.4, lines: [[0.15, 0, 0.15, 0.8], [0.15, 0.8, 0.25, 1], [0, 0.4, 0.35, 0.4], [0.15, 0, 0.3, 0], [0.3, 0, 0.4, 0.1]] },
  'u': { width: 0.6, lines: [[0, 0.4, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.5, 0], [0.5, 0, 0.6, 0.1], [0.6, 0.1, 0.6, 0.4]] },
  'v': { width: 0.6, lines: [[0, 0.4, 0.3, 0], [0.3, 0, 0.6, 0.4]] },
  'w': { width: 0.9, lines: [[0, 0.4, 0.15, 0], [0.15, 0, 0.35, 0.3], [0.35, 0.3, 0.55, 0], [0.55, 0, 0.7, 0.4]] },
  'x': { width: 0.5, lines: [[0, 0, 0.5, 0.4], [0, 0.4, 0.5, 0]] },
  'y': { width: 0.6, lines: [[0, 0.4, 0, 0.1], [0, 0.1, 0.1, 0], [0.1, 0, 0.6, 0], [0.6, 0.4, 0.6, -0.2], [0.6, -0.2, 0.5, -0.3], [0.5, -0.3, 0, -0.3]] },
  'z': { width: 0.5, lines: [[0, 0.4, 0.5, 0.4], [0.5, 0.4, 0, 0], [0, 0, 0.5, 0]] },
  // Symbols
  '(': { width: 0.3, lines: [[0.3, 1, 0.1, 0.75], [0.1, 0.75, 0.1, 0.25], [0.1, 0.25, 0.3, 0]] },
  ')': { width: 0.3, lines: [[0, 1, 0.2, 0.75], [0.2, 0.75, 0.2, 0.25], [0.2, 0.25, 0, 0]] },
  '.': { width: 0.2, lines: [[0.05, 0, 0.15, 0], [0.15, 0, 0.15, 0.1], [0.15, 0.1, 0.05, 0.1], [0.05, 0.1, 0.05, 0]] },
  ',': { width: 0.2, lines: [[0.1, 0.1, 0.1, 0], [0.1, 0, 0, -0.1]] },
  '-': { width: 0.4, lines: [[0, 0.25, 0.4, 0.25]] },
  ':': { width: 0.2, lines: [[0.05, 0, 0.15, 0], [0.15, 0, 0.15, 0.1], [0.15, 0.1, 0.05, 0.1], [0.05, 0.1, 0.05, 0], [0.05, 0.25, 0.15, 0.25], [0.15, 0.25, 0.15, 0.35], [0.15, 0.35, 0.05, 0.35], [0.05, 0.35, 0.05, 0.25]] },
  ' ': { width: 0.3, lines: [] },
  '/': { width: 0.4, lines: [[0, 0, 0.4, 1]] },
};

/**
 * Draw radius rings around the crane
 * OPTIMIZED: All rings and labels drawn in minimal API calls
 */
async function drawRadiusRings(
  api: WorkspaceAPI.WorkspaceAPI,
  centerX: number,
  centerY: number,
  centerZ: number,
  stepMeters: number,
  maxRadiusMeters: number,
  color: CraneRGBAColor,
  showLabels: boolean,
  loadChartData?: LoadChartDataPoint[],
  maxRadiusLimitMeters?: number,
  labelColor?: CraneRGBAColor,
  labelHeightMm?: number
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;

  const effectiveMaxRadius = maxRadiusLimitMeters && maxRadiusLimitMeters > 0
    ? Math.min(maxRadiusLimitMeters, maxRadiusMeters)
    : maxRadiusMeters;

  const textColor = labelColor || { ...color, a: 255 };
  const textHeight = labelHeightMm || 500;

  console.log('[CraneViz] Drawing radius rings:', { stepMeters, effectiveMaxRadius, showLabels });

  try {
    // Collect all freeline entries for batch call
    const freelineEntries: { color: CraneRGBAColor; lines: LineSegment[] }[] = [];

    // Generate all rings
    for (let r = stepMeters; r <= effectiveMaxRadius; r += stepMeters) {
      const radiusMm = r * 1000;

      // Use simplified dashed pattern: 8 dashes per ring (fewer markup entries)
      const dashCount = 8;
      const dashRatio = 0.7;
      const dashSegments = generateDottedCircleSegments(centerX, centerY, centerZ, radiusMm, dashCount, dashRatio);

      // Each dash is a separate entry (to avoid connection)
      for (const seg of dashSegments) {
        freelineEntries.push({ color, lines: [seg] });
      }

      // Add radius label if enabled
      if (showLabels) {
        const labelText = `${r}m`;
        // Each character separate to avoid connection
        let charX = centerX + radiusMm + 300;
        const charSpacing = textHeight * 0.2;
        for (const char of labelText.toLowerCase()) {
          const charDef = LINE_FONT[char];
          if (!charDef || charDef.lines.length === 0) {
            charX += (charDef?.width || 0.3) * textHeight + charSpacing;
            continue;
          }
          const charSegs: LineSegment[] = charDef.lines.map(([x1, y1, x2, y2]) => ({
            start: { positionX: charX + x1 * textHeight, positionY: centerY - textHeight / 2 + y1 * textHeight, positionZ: centerZ + 100 },
            end: { positionX: charX + x2 * textHeight, positionY: centerY - textHeight / 2 + y2 * textHeight, positionZ: centerZ + 100 }
          }));
          freelineEntries.push({ color: textColor, lines: charSegs });
          charX += charDef.width * textHeight + charSpacing;
        }

        // Capacity label if available
        if (loadChartData && loadChartData.length > 0) {
          const capacityPoint = loadChartData.find(lc => lc.radius_m === r);
          if (capacityPoint) {
            const capText = `${(capacityPoint.capacity_kg / 1000).toFixed(0)}t`;
            const capColor = { r: 0, g: 100, b: 180, a: 255 };
            let capX = centerX + radiusMm + 300;
            const capHeight = textHeight * 0.85;
            const capY = centerY - textHeight / 2 - textHeight * 1.2;
            for (const char of capText.toLowerCase()) {
              const charDef = LINE_FONT[char];
              if (!charDef || charDef.lines.length === 0) {
                capX += (charDef?.width || 0.3) * capHeight + charSpacing;
                continue;
              }
              const charSegs: LineSegment[] = charDef.lines.map(([x1, y1, x2, y2]) => ({
                start: { positionX: capX + x1 * capHeight, positionY: capY + y1 * capHeight, positionZ: centerZ + 100 },
                end: { positionX: capX + x2 * capHeight, positionY: capY + y2 * capHeight, positionZ: centerZ + 100 }
              }));
              freelineEntries.push({ color: capColor, lines: charSegs });
              capX += charDef.width * capHeight + charSpacing;
            }
          }
        }
      }
    }

    // Draw all in ONE batch call
    console.log('[CraneViz] Drawing', freelineEntries.length, 'ring/label entries in batch');
    if (freelineEntries.length > 0) {
      const markups = await markupApi.addFreelineMarkups?.(freelineEntries);
      if (markups) {
        markups.forEach((m: any) => { if (m?.id) markupIds.push(m.id); });
      }
    }

    console.log('[CraneViz] Radius rings complete, markupIds:', markupIds.length);
  } catch (error) {
    console.error('[CraneViz] Error drawing radius rings:', error);
  }

  return markupIds;
}

/**
 * Remove crane markups from the model
 */
export async function removeCraneMarkups(
  api: WorkspaceAPI.WorkspaceAPI,
  markupIds: number[]
): Promise<void> {
  if (markupIds.length === 0) return;

  try {
    await api.markup.removeMarkups(markupIds);
  } catch (error) {
    console.error('Failed to remove crane markups:', error);
  }
}

/**
 * Update crane position in the model
 * Removes old markups and draws new ones
 */
export async function updateCranePosition(
  api: WorkspaceAPI.WorkspaceAPI,
  projectCrane: ProjectCrane,
  craneModel: CraneModel,
  oldMarkupIds: number[],
  loadChartData?: LoadChartDataPoint[]
): Promise<number[]> {
  // Remove old markups
  await removeCraneMarkups(api, oldMarkupIds);

  // Draw new markups
  return drawCraneToModel(api, projectCrane, craneModel, loadChartData);
}

/**
 * Draw a single circle at a specific radius (for testing or preview)
 */
export async function drawCircle(
  api: WorkspaceAPI.WorkspaceAPI,
  centerX: number,
  centerY: number,
  centerZ: number,
  radiusMeters: number,
  color: CraneRGBAColor,
  label?: string
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;
  const segments = 72;
  const radiusMm = radiusMeters * 1000;

  try {
    // Generate circle with {start, end} line segments
    const lineSegments = generateCircleSegments(centerX, centerY, centerZ, radiusMm, segments);

    // Draw circle as freeline
    const circleMarkup = await markupApi.addFreelineMarkups?.([{
      color,
      lines: lineSegments
    }]);
    if (circleMarkup?.[0]?.id) markupIds.push(circleMarkup[0].id);

    // Add label if provided
    if (label) {
      const labelMarkup = await markupApi.addTextMarkup?.([{
        text: label,
        start: {
          positionX: centerX + radiusMm,
          positionY: centerY,
          positionZ: centerZ + 300
        },
        end: {
          positionX: centerX + radiusMm + 100,
          positionY: centerY + 100,
          positionZ: centerZ + 300
        }
      }]);
      if (labelMarkup?.[0]?.id) markupIds.push(labelMarkup[0].id);
    }

    return markupIds;
  } catch (error) {
    console.error('Error drawing circle:', error);
    return markupIds;
  }
}
