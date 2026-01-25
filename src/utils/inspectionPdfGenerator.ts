/**
 * PDF Generator for Inspection Reports
 *
 * Generates comprehensive inspection report PDFs with:
 * - Cover page with inspection metadata
 * - Checkpoint results with responses
 * - Photo pages
 * - Comments and notes
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  InspectionPlanItem,
  InspectionCheckpoint,
  InspectionResult,
  InspectionResultPhoto,
  InspectionCategory,
  InspectionTypeRef
} from '../supabase';

// PDF Configuration
const PAGE_WIDTH = 210; // A4 width in mm
const PAGE_HEIGHT = 297; // A4 height in mm
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

// Colors
const COLORS = {
  primary: [37, 99, 235] as [number, number, number],      // Blue
  success: [34, 197, 94] as [number, number, number],      // Green
  danger: [239, 68, 68] as [number, number, number],       // Red
  warning: [250, 204, 21] as [number, number, number],     // Yellow
  orange: [249, 115, 22] as [number, number, number],      // Orange
  gray: [107, 114, 128] as [number, number, number],       // Gray
  lightGray: [243, 244, 246] as [number, number, number],  // Light gray
  dark: [31, 41, 55] as [number, number, number],          // Dark
  white: [255, 255, 255] as [number, number, number]
};

// Response color mapping
const RESPONSE_COLORS: Record<string, [number, number, number]> = {
  green: COLORS.success,
  yellow: COLORS.warning,
  red: COLORS.danger,
  blue: COLORS.primary,
  gray: COLORS.gray,
  orange: COLORS.orange
};

/**
 * Inspection report data structure
 */
export interface InspectionReportData {
  // Project info
  projectName: string;
  projectNumber?: string;

  // Inspection plan info
  planItem: InspectionPlanItem;
  inspectionType?: InspectionTypeRef;
  category?: InspectionCategory;

  // Checkpoints and results
  checkpoints: InspectionCheckpoint[];
  results: (InspectionResult & {
    checkpoint?: InspectionCheckpoint;
    photos?: InspectionResultPhoto[];
  })[];

  // Additional metadata
  building?: string;
  level?: string;
  drawing?: string;
  coordinate?: string;

  // Optional images
  planViewUrl?: string;
  detailViewUrl?: string;

  // Instructions text (Markdown or plain text)
  instructions?: string;

  // Company branding
  companyName?: string;
  companyLogoUrl?: string;
}

/**
 * Maximum image dimension for PDF (keeps quality while reducing file size)
 */
const MAX_IMAGE_DIMENSION = 1600;

/**
 * Load image as data URL with dimensions, resizing if too large
 */
async function loadImageAsDataURL(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const originalDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject();
      reader.readAsDataURL(blob);
    });

    const result = await new Promise<{ dataUrl: string; width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = img;

        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          resolve({ dataUrl: originalDataUrl, width, height });
          return;
        }

        let newWidth = width;
        let newHeight = height;

        if (width > height) {
          newWidth = MAX_IMAGE_DIMENSION;
          newHeight = Math.round((height / width) * MAX_IMAGE_DIMENSION);
        } else {
          newHeight = MAX_IMAGE_DIMENSION;
          newWidth = Math.round((width / height) * MAX_IMAGE_DIMENSION);
        }

        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ dataUrl: resizedDataUrl, width: newWidth, height: newHeight });
        } else {
          resolve({ dataUrl: originalDataUrl, width, height });
        }
      };
      img.onerror = () => resolve({ dataUrl: originalDataUrl, width: 1, height: 1 });
      img.src = originalDataUrl;
    });

    return result;
  } catch {
    return null;
  }
}

/**
 * Calculate image dimensions to fit within a box while maintaining aspect ratio
 */
function calculateFitDimensions(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number
): { width: number; height: number; offsetX: number; offsetY: number } {
  const imgAspect = imgWidth / imgHeight;
  const boxAspect = boxWidth / boxHeight;

  let width: number;
  let height: number;

  if (imgAspect > boxAspect) {
    width = boxWidth;
    height = boxWidth / imgAspect;
  } else {
    height = boxHeight;
    width = boxHeight * imgAspect;
  }

  const offsetX = (boxWidth - width) / 2;
  const offsetY = (boxHeight - height) / 2;

  return { width, height, offsetX, offsetY };
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Get status text and color
 */
function getStatusInfo(_planItem: InspectionPlanItem, results: InspectionResult[]): { text: string; color: [number, number, number] } {
  if (results.length === 0) {
    return { text: 'Planned', color: COLORS.gray };
  }

  // Check if any result has a "red" response (failure)
  const hasFailure = results.some(r => {
    const responseColor = r.response_label?.toLowerCase();
    return responseColor === 'nok' || responseColor === 'no' || responseColor === 'fail';
  });

  if (hasFailure) {
    return { text: 'Issues Found', color: COLORS.danger };
  }

  return { text: 'Completed', color: COLORS.success };
}

/**
 * Draw page header
 */
function drawHeader(
  doc: jsPDF,
  title: string,
  code: string,
  pageNum: number,
  totalPages: number,
  companyName?: string
): number {
  // Header background
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, PAGE_WIDTH, 20, 'F');

  // Title
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, MARGIN, 13);

  // Code and page number
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const rightText = companyName ? `${companyName} | ${code} | ${pageNum}/${totalPages}` : `${code} | ${pageNum}/${totalPages}`;
  doc.text(rightText, PAGE_WIDTH - MARGIN, 13, { align: 'right' });

  return 25; // Return Y position after header
}

/**
 * Draw page footer
 */
function drawFooter(doc: jsPDF): void {
  const footerY = PAGE_HEIGHT - 10;

  doc.setDrawColor(...COLORS.lightGray);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY - 3, PAGE_WIDTH - MARGIN, footerY - 3);

  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(7);
  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.text(`Generated: ${generatedDate}`, PAGE_WIDTH - MARGIN, footerY + 1, { align: 'right' });
  doc.text('Assembly Inspector - Inspection Report', MARGIN, footerY + 1);
}

/**
 * Generate the complete inspection report PDF
 */
export async function generateInspectionReportPDF(
  data: InspectionReportData,
  onProgress?: (progress: number, message: string) => void
): Promise<Blob> {
  const {
    projectName,
    projectNumber,
    planItem,
    inspectionType,
    category,
    checkpoints,
    results,
    building,
    level,
    drawing,
    coordinate,
    planViewUrl,
    detailViewUrl,
    instructions,
    companyName
  } = data;

  onProgress?.(5, 'Creating PDF document...');

  // Create PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Collect all photos from results
  const allPhotos: { photo: InspectionResultPhoto; checkpointName?: string }[] = [];
  for (const result of results) {
    if (result.photos && result.photos.length > 0) {
      for (const photo of result.photos) {
        allPhotos.push({
          photo,
          checkpointName: result.checkpoint?.name || 'Unknown'
        });
      }
    }
  }

  // Calculate total pages (estimate)
  const photoPages = Math.ceil(allPhotos.length / 4);
  const hasImages = planViewUrl || detailViewUrl;
  const totalPages = 1 + (hasImages ? 1 : 0) + photoPages;

  let currentPage = 1;

  // ============================================
  // PAGE 1: OVERVIEW
  // ============================================

  const inspectionTitle = inspectionType?.name || 'Inspection Report';
  const inspectionCode = planItem.inspection_code || planItem.guid?.substring(0, 8) || 'N/A';

  let y = drawHeader(doc, inspectionTitle, inspectionCode, currentPage, totalPages, companyName);

  onProgress?.(10, 'Adding metadata...');

  // Two-column metadata table
  const leftColumnData = [
    ['Project', projectName || '-'],
    ['Project no.', projectNumber || '-'],
    ['Inspection plan', inspectionType?.name || '-'],
    ['Category', category?.name || '-'],
    ['Assembly mark', planItem.assembly_mark || '-'],
    ['Building', building || '-'],
    ['Level', level || '-'],
    ['Drawing', drawing || '-'],
    ['3D object category', planItem.object_type || '-'],
    ['3D object', planItem.object_name || '-'],
    ['Coordinate', coordinate || '-']
  ];

  // Get inspector info from first result
  const firstResult = results[0];
  const inspectorName = firstResult?.inspector_name || '-';
  const inspectedAt = firstResult?.inspected_at ? formatDate(firstResult.inspected_at) : '-';
  const statusInfo = getStatusInfo(planItem, results);

  const rightColumnData = [
    ['Created by', inspectorName],
    ['Created', inspectedAt],
    ['Modified by', inspectorName],
    ['Modified', inspectedAt],
    ['Status', statusInfo.text]
  ];

  // Location data if available
  if (planItem.cast_unit_position_code) {
    leftColumnData.push(['Position code', planItem.cast_unit_position_code]);
  }
  if (planItem.cast_unit_bottom_elevation) {
    leftColumnData.push(['Bottom elevation', planItem.cast_unit_bottom_elevation]);
  }
  if (planItem.cast_unit_top_elevation) {
    leftColumnData.push(['Top elevation', planItem.cast_unit_top_elevation]);
  }
  if (planItem.parent_assembly_mark) {
    leftColumnData.push(['Parent assembly', planItem.parent_assembly_mark]);
  }

  // Draw two-column metadata using autoTable
  const halfWidth = CONTENT_WIDTH / 2 - 2;

  // Left column
  autoTable(doc, {
    startY: y,
    head: [],
    body: leftColumnData,
    margin: { left: MARGIN },
    tableWidth: halfWidth,
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: COLORS.lightGray,
      lineWidth: 0.1
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 35 },
      1: { cellWidth: halfWidth - 35 }
    },
    theme: 'grid'
  });

  // Right column
  autoTable(doc, {
    startY: y,
    head: [],
    body: rightColumnData,
    margin: { left: MARGIN + halfWidth + 4 },
    tableWidth: halfWidth,
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: COLORS.lightGray,
      lineWidth: 0.1
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 30 },
      1: { cellWidth: halfWidth - 30 }
    },
    theme: 'grid',
    didDrawCell: (data) => {
      // Color the status cell
      if (data.row.index === 4 && data.column.index === 1) {
        doc.setTextColor(...statusInfo.color);
      }
    }
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  onProgress?.(20, 'Adding inspection instructions...');

  // Instructions section (if provided)
  if (instructions) {
    doc.setFillColor(...COLORS.lightGray);
    doc.setDrawColor(...COLORS.gray);

    // Section title
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Inspection Requirements:', MARGIN, y);
    y += 5;

    // Instructions text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.dark);

    // Split instructions into lines
    const instructionLines = doc.splitTextToSize(instructions, CONTENT_WIDTH);

    // Check if we need a new page
    const instructionsHeight = instructionLines.length * 4;
    if (y + instructionsHeight > PAGE_HEIGHT - 40) {
      // Truncate or continue on next page
      const availableLines = Math.floor((PAGE_HEIGHT - 40 - y) / 4);
      const truncatedLines = instructionLines.slice(0, availableLines);
      doc.text(truncatedLines, MARGIN, y);
      y += availableLines * 4 + 5;
    } else {
      doc.text(instructionLines, MARGIN, y);
      y += instructionsHeight + 5;
    }
  }

  // Horizontal separator
  doc.setDrawColor(...COLORS.lightGray);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 8;

  onProgress?.(30, 'Adding checkpoint results...');

  // Checkpoints section
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Check points:', MARGIN, y);
  y += 6;

  // Checkpoint results table
  const checkpointRows: (string | { content: string; styles?: any })[][] = [];

  for (const result of results) {
    const checkpoint = result.checkpoint || checkpoints.find(cp => cp.id === result.checkpoint_id);
    const checkpointName = checkpoint?.name || 'Unknown checkpoint';
    const responseValue = result.response_label || result.response_value || '-';

    // Determine response color
    let responseColor = COLORS.gray;
    const responseOpt = checkpoint?.response_options?.find(opt => opt.value === result.response_value);
    if (responseOpt?.color) {
      responseColor = RESPONSE_COLORS[responseOpt.color] || COLORS.gray;
    }

    checkpointRows.push([
      checkpointName,
      {
        content: responseValue,
        styles: {
          textColor: responseColor,
          fontStyle: 'bold'
        }
      }
    ]);

    // Add inspector info as subtitle
    if (result.inspector_name && result.inspected_at) {
      checkpointRows.push([
        {
          content: `Changed by ${result.inspector_name}, ${formatDate(result.inspected_at)}`,
          styles: {
            fontSize: 7,
            textColor: COLORS.gray,
            fontStyle: 'italic'
          }
        },
        ''
      ]);
    }

    // Add comment if present
    if (result.comment) {
      checkpointRows.push([
        {
          content: `Comment: ${result.comment}`,
          styles: { fontSize: 7, textColor: COLORS.gray }
        },
        ''
      ]);
    }
  }

  if (checkpointRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [],
      body: checkpointRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 9,
        cellPadding: 3,
        lineColor: COLORS.lightGray,
        lineWidth: 0.1
      },
      columnStyles: {
        0: { cellWidth: CONTENT_WIDTH - 30 },
        1: { cellWidth: 30, halign: 'right' }
      },
      theme: 'plain',
      alternateRowStyles: {
        fillColor: [250, 250, 250]
      }
    });

    y = (doc as any).lastAutoTable.finalY + 5;
  }

  // Notes section
  if (planItem.notes || planItem.planner_notes) {
    if (y > PAGE_HEIGHT - 50) {
      doc.addPage();
      currentPage++;
      y = drawHeader(doc, inspectionTitle, inspectionCode, currentPage, totalPages, companyName);
    }

    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Other notes or comments:', MARGIN, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    if (planItem.planner_notes) {
      const notesLines = doc.splitTextToSize(`Planner notes: ${planItem.planner_notes}`, CONTENT_WIDTH);
      doc.text(notesLines, MARGIN, y);
      y += notesLines.length * 4 + 3;
    }

    if (planItem.notes) {
      const notesLines = doc.splitTextToSize(`Notes: ${planItem.notes}`, CONTENT_WIDTH);
      doc.text(notesLines, MARGIN, y);
      y += notesLines.length * 4 + 3;
    }
  }

  drawFooter(doc);

  // ============================================
  // PAGE 2+: IMAGES (Plan view, Detail view)
  // ============================================

  onProgress?.(40, 'Loading images...');

  if (planViewUrl || detailViewUrl) {
    doc.addPage();
    currentPage++;
    y = drawHeader(doc, inspectionTitle, inspectionCode, currentPage, totalPages, companyName);

    const imageBoxHeight = (PAGE_HEIGHT - y - 30) / 2;
    const imageBoxWidth = CONTENT_WIDTH;

    if (planViewUrl) {
      onProgress?.(45, 'Loading plan view image...');
      const planImage = await loadImageAsDataURL(planViewUrl);
      if (planImage) {
        const dims = calculateFitDimensions(planImage.width, planImage.height, imageBoxWidth, imageBoxHeight - 10);

        // Draw border
        doc.setDrawColor(...COLORS.lightGray);
        doc.setLineWidth(0.5);
        doc.rect(MARGIN, y, imageBoxWidth, imageBoxHeight - 5);

        // Draw image
        doc.addImage(
          planImage.dataUrl,
          'JPEG',
          MARGIN + dims.offsetX,
          y + dims.offsetY,
          dims.width,
          dims.height
        );

        y += imageBoxHeight;
      }
    }

    if (detailViewUrl) {
      onProgress?.(50, 'Loading detail view image...');
      const detailImage = await loadImageAsDataURL(detailViewUrl);
      if (detailImage) {
        const dims = calculateFitDimensions(detailImage.width, detailImage.height, imageBoxWidth, imageBoxHeight - 10);

        // Draw border
        doc.setDrawColor(...COLORS.lightGray);
        doc.setLineWidth(0.5);
        doc.rect(MARGIN, y, imageBoxWidth, imageBoxHeight - 5);

        // Draw image
        doc.addImage(
          detailImage.dataUrl,
          'JPEG',
          MARGIN + dims.offsetX,
          y + dims.offsetY,
          dims.width,
          dims.height
        );
      }
    }

    drawFooter(doc);
  }

  // ============================================
  // PHOTO PAGES
  // ============================================

  if (allPhotos.length > 0) {
    onProgress?.(55, 'Adding photos...');

    const photosPerPage = 4;
    const photoBoxWidth = (CONTENT_WIDTH - 5) / 2;
    const photoBoxHeight = (PAGE_HEIGHT - 50 - 30) / 2;

    for (let i = 0; i < allPhotos.length; i += photosPerPage) {
      doc.addPage();
      currentPage++;
      y = drawHeader(doc, `${inspectionTitle} - Photos`, inspectionCode, currentPage, totalPages, companyName);

      const pagePhotos = allPhotos.slice(i, i + photosPerPage);
      const progressPercent = 55 + Math.round((i / allPhotos.length) * 40);
      onProgress?.(progressPercent, `Adding photo ${i + 1} of ${allPhotos.length}...`);

      for (let j = 0; j < pagePhotos.length; j++) {
        const { photo, checkpointName } = pagePhotos[j];

        // Calculate position (2x2 grid)
        const col = j % 2;
        const row = Math.floor(j / 2);
        const boxX = MARGIN + col * (photoBoxWidth + 5);
        const boxY = y + row * (photoBoxHeight + 10);

        // Draw photo border
        doc.setDrawColor(...COLORS.lightGray);
        doc.setLineWidth(0.5);
        doc.rect(boxX, boxY, photoBoxWidth, photoBoxHeight);

        // Load and draw photo
        try {
          const imageData = await loadImageAsDataURL(photo.url);
          if (imageData) {
            const dims = calculateFitDimensions(
              imageData.width,
              imageData.height,
              photoBoxWidth - 4,
              photoBoxHeight - 15
            );

            doc.addImage(
              imageData.dataUrl,
              'JPEG',
              boxX + 2 + dims.offsetX,
              boxY + 2 + dims.offsetY,
              dims.width,
              dims.height
            );
          }
        } catch (e) {
          // Draw placeholder if image fails to load
          doc.setFillColor(...COLORS.lightGray);
          doc.rect(boxX + 2, boxY + 2, photoBoxWidth - 4, photoBoxHeight - 15, 'F');
          doc.setTextColor(...COLORS.gray);
          doc.setFontSize(8);
          doc.text('Image not available', boxX + photoBoxWidth / 2, boxY + photoBoxHeight / 2, { align: 'center' });
        }

        // Photo caption
        doc.setTextColor(...COLORS.dark);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        const caption = checkpointName || 'Photo';
        doc.text(caption, boxX + 2, boxY + photoBoxHeight - 5, { maxWidth: photoBoxWidth - 4 });

        // Photo number
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(...COLORS.gray);
        doc.text(`${i + j + 1}`, boxX + photoBoxWidth - 5, boxY + photoBoxHeight - 5, { align: 'right' });
      }

      drawFooter(doc);
    }
  }

  onProgress?.(95, 'Finalizing PDF...');

  // Generate blob
  const blob = doc.output('blob');

  onProgress?.(100, 'PDF generated successfully!');

  return blob;
}

/**
 * Download inspection report PDF
 */
export async function downloadInspectionReportPDF(
  data: InspectionReportData,
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  const blob = await generateInspectionReportPDF(data, onProgress);

  // Create filename
  const assemblyMark = data.planItem.assembly_mark || 'inspection';
  const code = data.planItem.inspection_code || '';
  const date = new Date().toISOString().split('T')[0];
  const filename = `${code}_${assemblyMark}_${date}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate bulk inspection reports (multiple inspections in one PDF)
 */
export async function generateBulkInspectionReportPDF(
  reports: InspectionReportData[],
  _projectName: string,
  onProgress?: (progress: number, message: string) => void
): Promise<Blob> {
  // For bulk reports, we combine multiple reports into one PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  let currentPage = 1;
  const totalPages = reports.length; // Simplified estimate

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const progressPercent = Math.round((i / reports.length) * 100);
    onProgress?.(progressPercent, `Generating report ${i + 1} of ${reports.length}...`);

    if (i > 0) {
      doc.addPage();
    }

    // Generate single report page
    const inspectionTitle = report.inspectionType?.name || 'Inspection Report';
    const inspectionCode = report.planItem.inspection_code || report.planItem.guid?.substring(0, 8) || 'N/A';

    let y = drawHeader(doc, inspectionTitle, inspectionCode, currentPage, totalPages, report.companyName);

    // Simplified content for bulk reports
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(report.planItem.assembly_mark || 'N/A', MARGIN, y);
    y += 8;

    // Basic info
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Category: ${report.category?.name || '-'}`, MARGIN, y);
    y += 5;
    doc.text(`Object type: ${report.planItem.object_type || '-'}`, MARGIN, y);
    y += 5;

    const statusInfo = getStatusInfo(report.planItem, report.results);
    doc.setTextColor(...statusInfo.color);
    doc.text(`Status: ${statusInfo.text}`, MARGIN, y);
    y += 8;

    // Results summary
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Results:', MARGIN, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    for (const result of report.results) {
      const checkpoint = report.checkpoints.find(cp => cp.id === result.checkpoint_id);
      const checkpointName = checkpoint?.name || 'Unknown';
      const responseValue = result.response_label || result.response_value || '-';

      doc.text(`• ${checkpointName}: ${responseValue}`, MARGIN + 2, y);
      y += 4;

      if (y > PAGE_HEIGHT - 30) break; // Don't overflow page
    }

    drawFooter(doc);
    currentPage++;
  }

  onProgress?.(100, 'Bulk PDF generated successfully!');

  return doc.output('blob');
}
