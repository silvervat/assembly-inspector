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

  try {
    const allCraneSegments: LineSegment[] = [];
    const craneColor = projectCrane.crane_color;

    // === 1. MAIN CHASSIS (rectangle) ===
    const halfWidth = baseWidthMm / 2;
    const halfLength = baseLengthMm / 2;

    // Chassis corners
    const chassisCorners = [
      transformPoint(-halfWidth, -halfLength),
      transformPoint(halfWidth, -halfLength),
      transformPoint(halfWidth, halfLength),
      transformPoint(-halfWidth, halfLength)
    ];

    // Draw chassis rectangle
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      allCraneSegments.push({
        start: { positionX: chassisCorners[i].x, positionY: chassisCorners[i].y, positionZ: posZ },
        end: { positionX: chassisCorners[next].x, positionY: chassisCorners[next].y, positionZ: posZ }
      });
    }

    // === 2. OUTRIGGERS with SUPPORT PADS ===
    // 4 outriggers at corners, extending diagonally
    const outriggerPositions = [
      { cornerX: -halfWidth, cornerY: -halfLength, padX: -outriggerSpanMm / 2, padY: -outriggerSpanMm / 2 },
      { cornerX: halfWidth, cornerY: -halfLength, padX: outriggerSpanMm / 2, padY: -outriggerSpanMm / 2 },
      { cornerX: halfWidth, cornerY: halfLength, padX: outriggerSpanMm / 2, padY: outriggerSpanMm / 2 },
      { cornerX: -halfWidth, cornerY: halfLength, padX: -outriggerSpanMm / 2, padY: outriggerSpanMm / 2 }
    ];

    for (const outrigger of outriggerPositions) {
      const corner = transformPoint(outrigger.cornerX, outrigger.cornerY);
      const padCenter = transformPoint(outrigger.padX, outrigger.padY);

      // Outrigger beam (line from corner to pad)
      allCraneSegments.push({
        start: { positionX: corner.x, positionY: corner.y, positionZ: posZ },
        end: { positionX: padCenter.x, positionY: padCenter.y, positionZ: posZ }
      });

      // Support pad (square)
      const padHalf = outriggerPadSizeMm / 2;
      const padCorners = [
        transformPoint(outrigger.padX - padHalf, outrigger.padY - padHalf),
        transformPoint(outrigger.padX + padHalf, outrigger.padY - padHalf),
        transformPoint(outrigger.padX + padHalf, outrigger.padY + padHalf),
        transformPoint(outrigger.padX - padHalf, outrigger.padY + padHalf)
      ];

      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        allCraneSegments.push({
          start: { positionX: padCorners[i].x, positionY: padCorners[i].y, positionZ: posZ },
          end: { positionX: padCorners[next].x, positionY: padCorners[next].y, positionZ: posZ }
        });
      }
    }

    // === 3. CENTER TURNTABLE (circle) ===
    const turntableRadius = Math.min(baseWidthMm, baseLengthMm) * 0.3;
    const turntableSegments = 24;
    for (let i = 0; i < turntableSegments; i++) {
      const angle1 = (i / turntableSegments) * 2 * Math.PI;
      const angle2 = ((i + 1) / turntableSegments) * 2 * Math.PI;
      const p1 = transformPoint(turntableRadius * Math.cos(angle1), turntableRadius * Math.sin(angle1));
      const p2 = transformPoint(turntableRadius * Math.cos(angle2), turntableRadius * Math.sin(angle2));
      allCraneSegments.push({
        start: { positionX: p1.x, positionY: p1.y, positionZ: posZ + 100 },
        end: { positionX: p2.x, positionY: p2.y, positionZ: posZ + 100 }
      });
    }

    // === 4. BOOM INDICATOR (tapered shape pointing from center forward) ===
    const boomLength = baseLengthMm * 0.7; // Boom shown on chassis
    const boomBaseWidth = baseWidthMm * 0.25;
    const boomTipWidth = baseWidthMm * 0.1;

    // Boom is along Y axis (forward direction), starts from center
    const boomBase1 = transformPoint(-boomBaseWidth / 2, 0);
    const boomBase2 = transformPoint(boomBaseWidth / 2, 0);
    const boomTip1 = transformPoint(-boomTipWidth / 2, halfLength + boomLength * 0.3);
    const boomTip2 = transformPoint(boomTipWidth / 2, halfLength + boomLength * 0.3);

    // Boom outline (tapered trapezoid)
    allCraneSegments.push(
      { start: { positionX: boomBase1.x, positionY: boomBase1.y, positionZ: posZ + 200 },
        end: { positionX: boomTip1.x, positionY: boomTip1.y, positionZ: posZ + 200 } },
      { start: { positionX: boomTip1.x, positionY: boomTip1.y, positionZ: posZ + 200 },
        end: { positionX: boomTip2.x, positionY: boomTip2.y, positionZ: posZ + 200 } },
      { start: { positionX: boomTip2.x, positionY: boomTip2.y, positionZ: posZ + 200 },
        end: { positionX: boomBase2.x, positionY: boomBase2.y, positionZ: posZ + 200 } },
      { start: { positionX: boomBase2.x, positionY: boomBase2.y, positionZ: posZ + 200 },
        end: { positionX: boomBase1.x, positionY: boomBase1.y, positionZ: posZ + 200 } }
    );

    // Boom center line
    const boomStart = transformPoint(0, 0);
    const boomEnd = transformPoint(0, halfLength + boomLength * 0.3);
    allCraneSegments.push({
      start: { positionX: boomStart.x, positionY: boomStart.y, positionZ: posZ + 200 },
      end: { positionX: boomEnd.x, positionY: boomEnd.y, positionZ: posZ + 200 }
    });

    // === 5. CABIN (rectangle on one side) ===
    const cabinWidth = baseWidthMm * 0.3;
    const cabinLength = baseLengthMm * 0.2;
    let cabinCenterX = 0, cabinCenterY = 0;

    switch (craneModel.cab_position) {
      case 'front': cabinCenterY = halfLength - cabinLength / 2 - 100; break;
      case 'rear': cabinCenterY = -halfLength + cabinLength / 2 + 100; break;
      case 'left': cabinCenterX = -halfWidth + cabinWidth / 2 + 100; break;
      case 'right': cabinCenterX = halfWidth - cabinWidth / 2 - 100; break;
      default: cabinCenterY = -halfLength + cabinLength / 2 + 100; // Default rear
    }

    const cabinCorners = [
      transformPoint(cabinCenterX - cabinWidth / 2, cabinCenterY - cabinLength / 2),
      transformPoint(cabinCenterX + cabinWidth / 2, cabinCenterY - cabinLength / 2),
      transformPoint(cabinCenterX + cabinWidth / 2, cabinCenterY + cabinLength / 2),
      transformPoint(cabinCenterX - cabinWidth / 2, cabinCenterY + cabinLength / 2)
    ];

    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      allCraneSegments.push({
        start: { positionX: cabinCorners[i].x, positionY: cabinCorners[i].y, positionZ: posZ + 50 },
        end: { positionX: cabinCorners[next].x, positionY: cabinCorners[next].y, positionZ: posZ + 50 }
      });
    }

    // === 6. CENTER CROSS (+ mark at rotation center) ===
    const crossSize = 500;
    const cross1 = transformPoint(-crossSize, 0);
    const cross2 = transformPoint(crossSize, 0);
    const cross3 = transformPoint(0, -crossSize);
    const cross4 = transformPoint(0, crossSize);

    allCraneSegments.push(
      { start: { positionX: cross1.x, positionY: cross1.y, positionZ: posZ + 300 },
        end: { positionX: cross2.x, positionY: cross2.y, positionZ: posZ + 300 } },
      { start: { positionX: cross3.x, positionY: cross3.y, positionZ: posZ + 300 },
        end: { positionX: cross4.x, positionY: cross4.y, positionZ: posZ + 300 } }
    );

    // Draw all crane segments
    console.log('[CraneViz] Drawing', allCraneSegments.length, 'crane segments');
    const craneMarkup = await markupApi.addFreelineMarkups?.([{
      color: craneColor,
      lines: allCraneSegments
    }]);
    if (craneMarkup?.[0]?.id) markupIds.push(craneMarkup[0].id);

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

      const textWidth = calculateTextWidth(labelText, labelHeight);

      // Position label next to the crane (offset from outrigger span)
      const labelOffsetX = outriggerSpanMm / 2 + labelHeight + 500;
      const labelPos = transformPoint(labelOffsetX, -textWidth / 2);

      const labelSegments = generate3DTextTopView(
        labelText,
        labelPos.x,
        labelPos.y,
        posZ + 200,
        labelHeight
      );

      if (labelSegments.length > 0) {
        const textMarkup = await markupApi.addFreelineMarkups?.([{
          color: labelColor,
          lines: labelSegments
        }]);
        if (textMarkup?.[0]?.id) markupIds.push(textMarkup[0].id);
      }
    }

    console.log('[CraneViz] Total markups created:', markupIds.length);
    return markupIds;
  } catch (error) {
    console.error('[CraneViz] Error drawing crane to model:', error);
    return markupIds;
  }
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
 * Generate 3D text as line segments (readable from above - in X-Y plane)
 * @param text - Text to render
 * @param startX - Starting X position (mm)
 * @param startY - Starting Y position (mm)
 * @param startZ - Starting Z position (mm) - constant for all text
 * @param heightMm - Height of text in mm (e.g., 500 for 500mm tall)
 * @returns Array of line segments forming the text
 */
function generate3DTextTopView(
  text: string,
  startX: number,
  startY: number,
  startZ: number,
  heightMm: number
): LineSegment[] {
  const lineSegments: LineSegment[] = [];
  let currentX = startX;
  const spacing = heightMm * 0.2; // Space between characters

  for (const char of text.toLowerCase()) {
    const charDef = LINE_FONT[char];
    if (!charDef) continue;

    const charWidth = charDef.width * heightMm;

    for (const [x1, y1, x2, y2] of charDef.lines) {
      // Draw in X-Y plane (readable from above, looking down)
      // x1,x2 -> X axis (text width direction, left to right)
      // y1,y2 -> Y axis (text height direction, positive = up when viewing from above)
      // In font: y=0 is bottom of char, y=1 is top
      // When looking from above: higher Y = further "up" on screen = top of letter
      lineSegments.push({
        start: {
          positionX: currentX + x1 * heightMm,
          positionY: startY + y1 * heightMm, // Positive Y so text reads correctly from above
          positionZ: startZ
        },
        end: {
          positionX: currentX + x2 * heightMm,
          positionY: startY + y2 * heightMm,
          positionZ: startZ
        }
      });
    }

    currentX += charWidth + spacing;
  }

  return lineSegments;
}

/**
 * Calculate total width of text in mm
 */
function calculateTextWidth(text: string, heightMm: number): number {
  const spacing = heightMm * 0.2;
  let width = 0;
  for (const char of text.toLowerCase()) {
    const charDef = LINE_FONT[char];
    if (charDef) {
      width += charDef.width * heightMm + spacing;
    }
  }
  return width - spacing; // Remove last spacing
}

/**
 * Draw radius rings around the crane
 * @param maxRadiusLimitMeters - Optional limit for maximum radius to draw (defaults to crane's max radius)
 * @param labelColor - Optional separate color for labels (defaults to ring color)
 * @param labelHeightMm - Height of labels in mm (default 500)
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

  // Use limit if provided, otherwise use crane's max radius
  const effectiveMaxRadius = maxRadiusLimitMeters && maxRadiusLimitMeters > 0
    ? Math.min(maxRadiusLimitMeters, maxRadiusMeters)
    : maxRadiusMeters;

  // Calculate dash count based on radius for consistent dash size
  const baseDashCount = 48; // For a medium-sized radius

  // Use separate label color if provided, otherwise use ring color
  const textColor = labelColor || { ...color, a: 255 };
  const textHeight = labelHeightMm || 500; // Default 500mm tall letters

  console.log('[CraneViz] Drawing radius rings:', {
    centerX, centerY, centerZ,
    stepMeters, maxRadiusMeters, effectiveMaxRadius,
    showLabels, textHeight
  });

  try {
    // Generate rings with step interval - EACH RING SEPARATE to avoid line connections
    let ringIndex = 0;
    for (let r = stepMeters; r <= effectiveMaxRadius; r += stepMeters) {
      const radiusMm = r * 1000;

      // Adjust dash count based on radius for consistent dash size
      const baseDashForRadius = Math.max(24, Math.round(baseDashCount * (r / 20)));

      // Alternate between two patterns: every other ring has different dash pattern
      const isAlternate = ringIndex % 2 === 1;
      const dashCount = isAlternate ? Math.round(baseDashForRadius * 1.5) : baseDashForRadius;
      const dashRatio = isAlternate ? 0.4 : 0.7; // Shorter dashes on alternate rings

      // Generate dotted circle segments for THIS ring only
      const ringSegments = generateDottedCircleSegments(centerX, centerY, centerZ, radiusMm, dashCount, dashRatio);

      // Draw THIS ring as SEPARATE freeline (so dashes stay separate)
      if (ringSegments.length > 0) {
        // Each dash segment must be a separate freeline entry to avoid connection
        const ringMarkup = await markupApi.addFreelineMarkups?.(
          ringSegments.map(seg => ({
            color,
            lines: [seg]  // Each segment separate
          }))
        );
        if (ringMarkup) {
          ringMarkup.forEach((m: any) => {
            if (m?.id) markupIds.push(m.id);
          });
        }
      }

      ringIndex++;

      // Add label if enabled - using 3D geometry text (top-view readable)
      if (showLabels) {
        // Radius label - show radius in meters
        const radiusLabelText = `${r}m`;

        // Generate 3D text for radius label (readable from above)
        const radiusTextSegments = generate3DTextTopView(
          radiusLabelText,
          centerX + radiusMm + 300, // Offset from ring
          centerY - textHeight / 2, // Position label so it reads correctly from above
          centerZ + 100, // Slightly above ground
          textHeight
        );

        // Draw radius label
        if (radiusTextSegments.length > 0) {
          const radiusMarkup = await markupApi.addFreelineMarkups?.([{
            color: textColor,
            lines: radiusTextSegments
          }]);
          if (radiusMarkup?.[0]?.id) markupIds.push(radiusMarkup[0].id);
        }

        // Capacity label - show capacity at this radius (if load chart data available)
        if (loadChartData && loadChartData.length > 0) {
          // Find exact or interpolated capacity at this radius
          const capacityPoint = loadChartData.find(lc => lc.radius_m === r);

          if (capacityPoint) {
            const capacityText = `${(capacityPoint.capacity_kg / 1000).toFixed(0)}t`;
            console.log('[CraneViz] Capacity label at', r, 'm:', capacityText);

            // Position capacity label BELOW the radius label
            const capacityTextSegments = generate3DTextTopView(
              capacityText,
              centerX + radiusMm + 300, // Same X as radius label
              centerY - textHeight / 2 - textHeight * 1.2, // Below radius label
              centerZ + 100, // Same height
              textHeight * 0.85 // Slightly smaller text
            );

            // Draw capacity label in different color (blue tint)
            if (capacityTextSegments.length > 0) {
              const capacityColor = { r: 0, g: 100, b: 180, a: 255 };
              const capacityMarkup = await markupApi.addFreelineMarkups?.([{
                color: capacityColor,
                lines: capacityTextSegments
              }]);
              if (capacityMarkup?.[0]?.id) markupIds.push(capacityMarkup[0].id);
            }
          }
        }
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
