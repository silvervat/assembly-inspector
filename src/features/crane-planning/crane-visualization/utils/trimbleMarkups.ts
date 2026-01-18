import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import { ProjectCrane, CraneModel, CraneRGBAColor, LoadChartDataPoint } from '../../../../supabase';

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

  const boomLengthMm = projectCrane.boom_length_m * 1000;
  const rotationRad = (projectCrane.rotation_deg * Math.PI) / 180;

  try {
    // 1. Draw crane base (rectangle)
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

    // 2. Draw mast (vertical line)
    const mastHeight = craneModel.max_height_m * 1000 * 0.5; // Show 50% of max height
    const mastMarkup = await markupApi.addLineMarkups?.([{
      start: {
        positionX: posX,
        positionY: posY,
        positionZ: posZ
      },
      end: {
        positionX: posX,
        positionY: posY,
        positionZ: posZ + mastHeight
      },
      color: projectCrane.crane_color
    }]);
    if (mastMarkup?.[0]?.id) markupIds.push(mastMarkup[0].id);

    // 3. Draw boom (horizontal line from top of mast)
    const boomEndX = posX + boomLengthMm * Math.cos(rotationRad);
    const boomEndY = posY + boomLengthMm * Math.sin(rotationRad);

    const boomMarkup = await markupApi.addLineMarkups?.([{
      start: {
        positionX: posX,
        positionY: posY,
        positionZ: posZ + mastHeight
      },
      end: {
        positionX: boomEndX,
        positionY: boomEndY,
        positionZ: posZ + mastHeight
      },
      color: { ...projectCrane.crane_color, a: 200 }
    }]);
    if (boomMarkup?.[0]?.id) markupIds.push(boomMarkup[0].id);

    // 4. Draw hook point marker using a small circle at boom end
    const hookCircle = await drawSmallMarker(
      api,
      boomEndX,
      boomEndY,
      posZ + mastHeight,
      { r: 255, g: 0, b: 0, a: 255 }
    );
    markupIds.push(...hookCircle);

    // 5. Draw cabin marker
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

    // 6. Draw radius rings (if enabled)
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
        loadChartData
      );
      markupIds.push(...radiusMarkups);
    }

    // 7. Draw position label (if set)
    if (projectCrane.position_label) {
      const labelMarkup = await markupApi.addTextMarkup?.([{
        text: `${projectCrane.position_label}\n${craneModel.manufacturer} ${craneModel.model}`,
        start: {
          positionX: posX,
          positionY: posY,
          positionZ: posZ + mastHeight + 2000 // +2m above mast
        },
        end: {
          positionX: posX + 100,
          positionY: posY + 100,
          positionZ: posZ + mastHeight + 2000
        }
      }]);
      if (labelMarkup?.[0]?.id) markupIds.push(labelMarkup[0].id);
    }

    return markupIds;
  } catch (error) {
    console.error('Error drawing crane to model:', error);
    return markupIds;
  }
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
  const markerRadius = 200; // 200mm marker
  const segments = 8;

  try {
    const circlePoints: { positionX: number; positionY: number; positionZ: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      circlePoints.push({
        positionX: x + markerRadius * Math.cos(angle),
        positionY: y + markerRadius * Math.sin(angle),
        positionZ: z
      });
    }

    const markerMarkup = await markupApi.addFreelineMarkups?.([{
      color,
      lines: circlePoints
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
  const corners = [
    { x: -halfWidth, y: -halfLength },
    { x: halfWidth, y: -halfLength },
    { x: halfWidth, y: halfLength },
    { x: -halfWidth, y: halfLength },
    { x: -halfWidth, y: -halfLength } // Close the rectangle
  ].map(corner => {
    const rotatedX = corner.x * Math.cos(rotation) - corner.y * Math.sin(rotation);
    const rotatedY = corner.x * Math.sin(rotation) + corner.y * Math.cos(rotation);
    return {
      positionX: centerX + rotatedX,
      positionY: centerY + rotatedY,
      positionZ: centerZ
    };
  });

  try {
    // Draw as freeline
    const freeline = await markupApi.addFreelineMarkups?.([{
      color,
      lines: corners
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
  loadChartData?: LoadChartDataPoint[]
): Promise<number[]> {
  const markupIds: number[] = [];
  const markupApi = api.markup as any;
  const segments = 72; // 5° per segment

  try {
    // Generate rings with step interval
    for (let r = stepMeters; r <= maxRadiusMeters; r += stepMeters) {
      const radiusMm = r * 1000;

      // Generate circle points
      const circlePoints: { positionX: number; positionY: number; positionZ: number }[] = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        circlePoints.push({
          positionX: centerX + radiusMm * Math.cos(angle),
          positionY: centerY + radiusMm * Math.sin(angle),
          positionZ: centerZ
        });
      }

      // Draw ring as freeline
      const ringMarkup = await markupApi.addFreelineMarkups?.([{
        color,
        lines: circlePoints
      }]);
      if (ringMarkup?.[0]?.id) markupIds.push(ringMarkup[0].id);

      // Add label if enabled
      if (showLabels) {
        // Find capacity at this radius
        let capacityText = '';
        if (loadChartData) {
          const capacityPoint = loadChartData.find(lc => lc.radius_m === r);
          if (capacityPoint) {
            capacityText = ` (${(capacityPoint.capacity_kg / 1000).toFixed(1)}t)`;
          }
        }

        const labelMarkup = await markupApi.addTextMarkup?.([{
          text: `${r}m${capacityText}`,
          start: {
            positionX: centerX + radiusMm,
            positionY: centerY,
            positionZ: centerZ + 300 // 0.3m up
          },
          end: {
            positionX: centerX + radiusMm + 100,
            positionY: centerY + 100,
            positionZ: centerZ + 300
          }
        }]);
        if (labelMarkup?.[0]?.id) markupIds.push(labelMarkup[0].id);
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
    // Generate circle points
    const circlePoints: { positionX: number; positionY: number; positionZ: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      circlePoints.push({
        positionX: centerX + radiusMm * Math.cos(angle),
        positionY: centerY + radiusMm * Math.sin(angle),
        positionZ: centerZ
      });
    }

    // Draw circle as freeline
    const circleMarkup = await markupApi.addFreelineMarkups?.([{
      color,
      lines: circlePoints
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
