import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { ProjectCrane, CraneModel, CraneRGBAColor, LoadChartDataPoint } from '../../../../supabase';

// Line segment type for FreelineMarkup
interface LineSegment {
  start: { positionX: number; positionY: number; positionZ: number };
  end: { positionX: number; positionY: number; positionZ: number };
}

/**
 * Draw a complete crane visualization in the model
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

  try {
    // 1. Draw crane base (rectangle) - simple top view to scale
    const baseMarkups = await drawCraneBase(
      api,
      posX,
      posY,
      posZ,
      craneModel.base_width_m * 1000,
      craneModel.base_length_m * 1000,
      rotationRad,
      projectCrane.crane_color
    );
    markupIds.push(...baseMarkups);

    // 2. Draw cabin marker
    const cabinMarkups = await drawCabinMarker(
      api,
      posX,
      posY,
      posZ,
      craneModel.cab_position,
      craneModel.base_width_m * 1000,
      craneModel.base_length_m * 1000,
      rotationRad
    );
    markupIds.push(...cabinMarkups);

    // 3. Draw radius rings (if enabled)
    if (projectCrane.show_radius_rings) {
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
        projectCrane.label_color // Pass separate label color if set
      );
      markupIds.push(...radiusMarkups);
    }

    // 4. Draw position label (if set) - using 3D text readable from above
    if (projectCrane.position_label) {
      const labelText = projectCrane.position_label;
      const labelHeight = 800; // 800mm tall for crane name
      const labelColor = projectCrane.label_color || { r: 50, g: 50, b: 50, a: 255 };

      // Generate 3D text for position label
      const textWidth = calculateTextWidth(labelText, labelHeight);
      const labelSegments = generate3DTextTopView(
        labelText,
        posX - textWidth / 2, // Center above crane
        posY + labelHeight / 2,
        posZ + 200, // Just above ground
        labelHeight
      );

      // Draw each line segment separately for better rendering
      for (const segment of labelSegments) {
        const textMarkup = await markupApi.addLineMarkups?.([{
          start: segment.start,
          end: segment.end,
          color: labelColor
        }]);
        if (textMarkup?.[0]?.id) markupIds.push(textMarkup[0].id);
      }
    }

    return markupIds;
  } catch (error) {
    console.error('Error drawing crane to model:', error);
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
      // Draw in X-Y plane (readable from above)
      // x1,x2 -> X axis (text width direction)
      // y1,y2 -> Y axis (text height direction, going negative = up when viewing from above)
      lineSegments.push({
        start: {
          positionX: currentX + x1 * heightMm,
          positionY: startY - y1 * heightMm, // Negative so text reads correctly from above
          positionZ: startZ
        },
        end: {
          positionX: currentX + x2 * heightMm,
          positionY: startY - y2 * heightMm,
          positionZ: startZ // Constant Z for top view
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
 * Draw a small marker (tiny circle) at a point
 */
async function drawSmallMarker(
  api: WorkspaceAPI.WorkspaceAPI,
  x: number,
  y: number,
  z: number,
  color: CraneRGBAColor
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;
  const markerRadius = 500; // 500mm marker for visibility
  const segments = 16;

  try {
    // Generate circle with {start, end} line segments
    const lineSegments = generateCircleSegments(x, y, z, markerRadius, segments);

    const markerMarkup = await markupApi.addFreelineMarkups?.([{
      color,
      lines: lineSegments
    }]);
    if (markerMarkup?.[0]?.id) markupIds.push(markerMarkup[0].id);
  } catch (error) {
    console.error('Error drawing marker:', error);
  }

  return markupIds;
}

/**
 * Draw crane base as a rectangle
 */
async function drawCraneBase(
  api: WorkspaceAPI.WorkspaceAPI,
  centerX: number,
  centerY: number,
  centerZ: number,
  widthMm: number,
  lengthMm: number,
  rotation: number,
  color: CraneRGBAColor
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;

  const halfWidth = widthMm / 2;
  const halfLength = lengthMm / 2;

  // Calculate corner points (rotated)
  const cornerOffsets = [
    { x: -halfWidth, y: -halfLength },
    { x: halfWidth, y: -halfLength },
    { x: halfWidth, y: halfLength },
    { x: -halfWidth, y: halfLength }
  ];

  const corners = cornerOffsets.map(corner => {
    const rotatedX = corner.x * Math.cos(rotation) - corner.y * Math.sin(rotation);
    const rotatedY = corner.x * Math.sin(rotation) + corner.y * Math.cos(rotation);
    return {
      positionX: centerX + rotatedX,
      positionY: centerY + rotatedY,
      positionZ: centerZ
    };
  });

  // Create line segments connecting corners
  const lineSegments: LineSegment[] = [];
  for (let i = 0; i < corners.length; i++) {
    const nextI = (i + 1) % corners.length;
    lineSegments.push({
      start: corners[i],
      end: corners[nextI]
    });
  }

  try {
    // Draw as freeline with proper {start, end} segments
    const freeline = await markupApi.addFreelineMarkups?.([{
      color,
      lines: lineSegments
    }]);
    if (freeline?.[0]?.id) markupIds.push(freeline[0].id);
  } catch (error) {
    console.error('Error drawing crane base:', error);
  }

  return markupIds;
}

/**
 * Draw cabin marker to indicate crane orientation
 */
async function drawCabinMarker(
  api: WorkspaceAPI.WorkspaceAPI,
  centerX: number,
  centerY: number,
  centerZ: number,
  cabPosition: string,
  widthMm: number,
  lengthMm: number,
  rotation: number
): Promise<number[]> {
  const markupIds: number[] = [];

  let offsetX = 0, offsetY = 0;

  switch (cabPosition) {
    case 'front':
      offsetY = lengthMm / 2;
      break;
    case 'rear':
      offsetY = -lengthMm / 2;
      break;
    case 'left':
      offsetX = -widthMm / 2;
      break;
    case 'right':
      offsetX = widthMm / 2;
      break;
  }

  // Rotate offset
  const rotatedX = offsetX * Math.cos(rotation) - offsetY * Math.sin(rotation);
  const rotatedY = offsetX * Math.sin(rotation) + offsetY * Math.cos(rotation);

  try {
    const cabMarker = await drawSmallMarker(
      api,
      centerX + rotatedX,
      centerY + rotatedY,
      centerZ + 500, // 0.5m up
      { r: 0, g: 0, b: 255, a: 255 } // Blue
    );
    markupIds.push(...cabMarker);
  } catch (error) {
    console.error('Error drawing cabin marker:', error);
  }

  return markupIds;
}

/**
 * Draw radius rings around the crane
 * @param maxRadiusLimitMeters - Optional limit for maximum radius to draw (defaults to crane's max radius)
 * @param labelColor - Optional separate color for labels (defaults to ring color)
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
  labelColor?: CraneRGBAColor
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

  try {
    // Generate rings with step interval
    let ringIndex = 0;
    for (let r = stepMeters; r <= effectiveMaxRadius; r += stepMeters) {
      const radiusMm = r * 1000;

      // Adjust dash count based on radius for consistent dash size
      const baseDashForRadius = Math.max(24, Math.round(baseDashCount * (r / 20)));

      // Alternate between two patterns: every other ring has different dash pattern
      const isAlternate = ringIndex % 2 === 1;
      const dashCount = isAlternate ? Math.round(baseDashForRadius * 1.5) : baseDashForRadius;
      const dashRatio = isAlternate ? 0.4 : 0.7; // Shorter dashes on alternate rings

      // Generate dotted circle with {start, end} line segments
      const lineSegments = generateDottedCircleSegments(centerX, centerY, centerZ, radiusMm, dashCount, dashRatio);

      // Draw ring as freeline (dotted)
      const ringMarkup = await markupApi.addFreelineMarkups?.([{
        color,
        lines: lineSegments
      }]);
      if (ringMarkup?.[0]?.id) markupIds.push(ringMarkup[0].id);

      ringIndex++;

      // Add label if enabled - using 3D geometry text (top-view readable)
      if (showLabels) {
        // Find capacity at this radius
        let labelText = `${r}m`;
        if (loadChartData) {
          const capacityPoint = loadChartData.find(lc => lc.radius_m === r);
          if (capacityPoint) {
            labelText = `${r}m (${(capacityPoint.capacity_kg / 1000).toFixed(0)}t)`;
          }
        }

        // Generate 3D text (500mm tall, readable from above)
        const textHeight = 500; // 500mm tall letters
        const textSegments = generate3DTextTopView(
          labelText,
          centerX + radiusMm + 300, // Offset from ring
          centerY + textHeight / 2, // Center text vertically relative to ring
          centerZ + 100, // Slightly above ground
          textHeight
        );

        if (textSegments.length > 0) {
          // Draw each line segment separately for better rendering
          for (const segment of textSegments) {
            const textMarkup = await markupApi.addLineMarkups?.([{
              start: segment.start,
              end: segment.end,
              color: textColor
            }]);
            if (textMarkup?.[0]?.id) markupIds.push(textMarkup[0].id);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error drawing radius rings:', error);
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
