/**
 * Professional PDF Generator for Delivery Reports
 *
 * Generates a comprehensive delivery report PDF with:
 * - Cover page with summary
 * - Items table with status
 * - Photo pages with QR codes
 * - Footer with online gallery link
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import {
  ArrivedVehicle,
  DeliveryVehicle,
  DeliveryItem,
  ArrivalItemConfirmation,
  ArrivalPhoto
} from '../supabase';
import { formatDateEnglish, formatTime, getStatusLabelEnglish, getPhotoTypeLabelEnglish } from './shareUtils';

/**
 * Translate Estonian notes to English
 */
function translateNotesToEnglish(notes: string): string {
  if (!notes) return '';

  let translated = notes;

  // Common patterns
  translated = translated.replace(/Lisatud mudelist \(polnud tarnegraafikus\)/gi, 'Added from model (not in delivery schedule)');
  translated = translated.replace(/Lisatud mudelist/gi, 'Added from model');
  translated = translated.replace(/Lisatud veokist/gi, 'Added from vehicle');
  translated = translated.replace(/saabus veokiga/gi, 'arrived with vehicle');
  translated = translated.replace(/Detail/gi, 'Item');
  translated = translated.replace(/polnud tarnegraafikus/gi, 'not in delivery schedule');
  translated = translated.replace(/puudub/gi, 'missing');
  translated = translated.replace(/kinnitatud/gi, 'confirmed');
  translated = translated.replace(/lisatud/gi, 'added');

  return translated;
}

// PDF Configuration
const PAGE_WIDTH = 210; // A4 width in mm
const PAGE_HEIGHT = 297; // A4 height in mm
const MARGIN = 12; // Smaller margins for more content
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

// Colors
const COLORS = {
  primary: [37, 99, 235] as [number, number, number],      // Blue
  success: [34, 197, 94] as [number, number, number],      // Green
  danger: [239, 68, 68] as [number, number, number],       // Red
  warning: [250, 204, 21] as [number, number, number],     // Yellow
  gray: [107, 114, 128] as [number, number, number],       // Gray
  lightGray: [243, 244, 246] as [number, number, number],  // Light gray
  dark: [31, 41, 55] as [number, number, number],          // Dark
  white: [255, 255, 255] as [number, number, number]
};

interface DeliveryFactory {
  id: string;
  factory_name: string;
}

export interface DeliveryReportData {
  projectName: string;
  vehicle: DeliveryVehicle;
  factory?: DeliveryFactory;
  arrivedVehicle: ArrivedVehicle;
  items: DeliveryItem[];
  confirmations: ArrivalItemConfirmation[];
  photos: ArrivalPhoto[];
  shareUrl: string;
}

/**
 * Generate QR code as data URL
 */
async function generateQRCode(url: string, size: number = 100): Promise<string> {
  try {
    return await QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: {
        dark: '#1f2937',
        light: '#ffffff'
      }
    });
  } catch (e) {
    console.error('Error generating QR code:', e);
    return '';
  }
}

// Maximum image dimension for PDF (keeps quality while reducing file size)
const MAX_IMAGE_DIMENSION = 2048;

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

    // Load image to get dimensions and potentially resize
    const result = await new Promise<{ dataUrl: string; width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = img;

        // Check if resizing is needed
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          // No resize needed
          resolve({ dataUrl: originalDataUrl, width, height });
          return;
        }

        // Calculate new dimensions maintaining aspect ratio
        let newWidth = width;
        let newHeight = height;

        if (width > height) {
          newWidth = MAX_IMAGE_DIMENSION;
          newHeight = Math.round((height / width) * MAX_IMAGE_DIMENSION);
        } else {
          newHeight = MAX_IMAGE_DIMENSION;
          newWidth = Math.round((width / height) * MAX_IMAGE_DIMENSION);
        }

        // Resize using canvas
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ dataUrl: resizedDataUrl, width: newWidth, height: newHeight });
        } else {
          // Fallback to original if canvas fails
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
    // Image is wider than box - fit to width
    width = boxWidth;
    height = boxWidth / imgAspect;
  } else {
    // Image is taller than box - fit to height
    height = boxHeight;
    width = boxHeight * imgAspect;
  }

  // Center the image in the box
  const offsetX = (boxWidth - width) / 2;
  const offsetY = (boxHeight - height) / 2;

  return { width, height, offsetX, offsetY };
}

/**
 * Draw page header (compact)
 */
function drawHeader(
  doc: jsPDF,
  projectName: string,
  vehicleCode: string,
  pageNum: number,
  totalPages: number
): void {
  // Header background - compact
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, PAGE_WIDTH, 18, 'F');

  // Project name + Vehicle code on same line
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`${projectName} | ${vehicleCode}`, MARGIN, 11);

  // Page number and title
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`DELIVERY REPORT | ${pageNum}/${totalPages}`, PAGE_WIDTH - MARGIN, 11, { align: 'right' });
}

/**
 * Draw simple page footer (without QR - for photo pages)
 */
function drawSimpleFooter(doc: jsPDF, shareUrl: string): void {
  const footerY = PAGE_HEIGHT - 10;

  // Footer line
  doc.setDrawColor(...COLORS.lightGray);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY - 3, PAGE_WIDTH - MARGIN, footerY - 3);

  // URL text
  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(6);
  doc.textWithLink(shareUrl, MARGIN, footerY + 2, { url: shareUrl });

  // Generation date
  doc.setTextColor(...COLORS.gray);
  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  doc.text(`Generated: ${generatedDate}`, PAGE_WIDTH - MARGIN, footerY + 2, { align: 'right' });
}

/**
 * Generate the complete PDF report
 */
export async function generateDeliveryReportPDF(data: DeliveryReportData): Promise<Blob> {
  const { projectName, vehicle, factory, arrivedVehicle, items, confirmations, photos, shareUrl } = data;

  // Pre-generate QR code for first page only
  const mainQRCode = await generateQRCode(shareUrl, 150);

  // Calculate totals
  const confirmedCount = confirmations.filter(c => c.status === 'confirmed').length;
  const missingCount = confirmations.filter(c => c.status === 'missing').length;
  const addedCount = confirmations.filter(c => c.status === 'added').length;
  const totalWeight = items.reduce((sum, item) => sum + (Number(item.cast_unit_weight) || 0), 0);

  // Create PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Calculate total pages (estimate)
  const photoPages = Math.ceil(photos.length / 4);
  const totalPages = 1 + photoPages + (photos.length > 0 ? 0 : 0);

  let currentPage = 1;

  // ============================================
  // PAGE 1: OVERVIEW (COMPACT)
  // ============================================

  drawHeader(doc, projectName, vehicle?.vehicle_code || '-', currentPage, totalPages);

  let y = 24;

  // Title row - compact
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const factoryText = factory?.factory_name ? ` (${factory.factory_name})` : '';
  doc.text(`Delivery Report: ${vehicle?.vehicle_code || '-'}${factoryText}`, MARGIN, y);
  y += 8;

  // Summary line - single row
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  const scheduledText = vehicle?.scheduled_date ? formatDateEnglish(vehicle.scheduled_date) : '-';
  const arrivalText = `${formatDateEnglish(arrivedVehicle.arrival_date)} ${formatTime(arrivedVehicle.arrival_time)}`;
  const statusText = arrivedVehicle.is_confirmed ? '✓ CONFIRMED' : 'In Progress';
  doc.text(`Scheduled: ${scheduledText} | Arrived: ${arrivalText} | Items: ${items.length} | Weight: ${Math.round(totalWeight).toLocaleString()} kg | ${statusText}`, MARGIN, y);
  y += 6;

  // Vehicle notes (if any) - translated to English
  if (arrivedVehicle.notes && arrivedVehicle.notes.trim()) {
    doc.setFillColor(255, 251, 235); // Light yellow background
    const translatedNotes = translateNotesToEnglish(arrivedVehicle.notes);
    const noteLines = doc.splitTextToSize(`Vehicle notes: ${translatedNotes}`, CONTENT_WIDTH - 6);
    const noteHeight = noteLines.length * 4 + 4;
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, noteHeight, 2, 2, 'F');
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(8);
    doc.text(noteLines, MARGIN + 3, y + 5);
    y += noteHeight + 3;
  }

  // Status badges - compact inline (small pills)
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');

  // Calculate badge widths based on text
  const badgeHeight = 6;
  const badgePadding = 4;
  const badgeGap = 3;

  // Confirmed badge
  const confirmedText = `✓ ${confirmedCount} Confirmed`;
  const confirmedWidth = doc.getTextWidth(confirmedText) + badgePadding * 2;
  doc.setFillColor(...COLORS.success);
  doc.roundedRect(MARGIN, y, confirmedWidth, badgeHeight, 1.5, 1.5, 'F');
  doc.setTextColor(...COLORS.white);
  doc.text(confirmedText, MARGIN + badgePadding, y + 4.2);

  // Missing badge
  const missingText = `✗ ${missingCount} Missing`;
  const missingWidth = doc.getTextWidth(missingText) + badgePadding * 2;
  doc.setFillColor(...COLORS.danger);
  doc.roundedRect(MARGIN + confirmedWidth + badgeGap, y, missingWidth, badgeHeight, 1.5, 1.5, 'F');
  doc.text(missingText, MARGIN + confirmedWidth + badgeGap + badgePadding, y + 4.2);

  // Added badge
  const addedText = `+ ${addedCount} Added`;
  const addedWidth = doc.getTextWidth(addedText) + badgePadding * 2;
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(MARGIN + confirmedWidth + badgeGap + missingWidth + badgeGap, y, addedWidth, badgeHeight, 1.5, 1.5, 'F');
  doc.text(addedText, MARGIN + confirmedWidth + badgeGap + missingWidth + badgeGap + badgePadding, y + 4.2);

  y += badgeHeight + 4;

  // Items Table - compact with GUID on the right
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('ITEMS', MARGIN, y);
  y += 3;

  // Sort items alphabetically by assembly_mark
  const sortedItems = [...items].sort((a, b) =>
    (a.assembly_mark || '').localeCompare(b.assembly_mark || '', 'et')
  );

  // Prepare table data - GUID on the right, notes translated
  const tableData = sortedItems.map((item, idx) => {
    const conf = confirmations.find(c => c.item_id === item.id);
    const status = conf?.status || 'pending';
    const notes = conf?.notes ? translateNotesToEnglish(conf.notes) : '';
    return [
      (idx + 1).toString(),
      item.assembly_mark || '-',
      item.cast_unit_weight ? `${Math.round(Number(item.cast_unit_weight))}` : '-',
      getStatusLabelEnglish(status),
      notes,
      item.guid_ifc || '-'  // Full GUID on the right
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Mark', 'kg', 'Status', 'Notes', 'GUID']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: COLORS.dark,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 1.5
    },
    bodyStyles: {
      fontSize: 6,
      textColor: COLORS.dark,
      cellPadding: 1.5
    },
    columnStyles: {
      0: { cellWidth: 7 },   // #
      1: { cellWidth: 22 },  // Mark
      2: { cellWidth: 10 },  // Weight
      3: { cellWidth: 16 },  // Status
      4: { cellWidth: 'auto' }, // Notes - flexible
      5: { cellWidth: 45, fontSize: 5 }  // GUID - full width, smaller font
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      // Color status column (index 3)
      if (data.column.index === 3 && data.section === 'body') {
        const status = tableData[data.row.index]?.[3] || '';
        if (status === 'Confirmed') {
          data.cell.styles.textColor = COLORS.success;
          data.cell.styles.fontStyle = 'bold';
        } else if (status === 'Missing') {
          data.cell.styles.textColor = COLORS.danger;
          data.cell.styles.fontStyle = 'bold';
        } else if (status === 'Added') {
          data.cell.styles.textColor = COLORS.primary;
          data.cell.styles.fontStyle = 'bold';
        }
      }
      // Notes column styling (index 4)
      if (data.column.index === 4 && data.section === 'body') {
        data.cell.styles.textColor = COLORS.gray;
        data.cell.styles.fontSize = 5;
      }
      // GUID column styling (index 5)
      if (data.column.index === 5 && data.section === 'body') {
        data.cell.styles.textColor = COLORS.gray;
        data.cell.styles.fontSize = 5;
      }
    }
  });

  // Get final Y position after table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 5;

  // QR Code and link - compact box at bottom of page 1 only
  const qrBoxHeight = 18;
  const footerStart = PAGE_HEIGHT - 10; // Where simple footer starts

  if (y < footerStart - qrBoxHeight - 3) {
    // Position QR box just above footer
    y = footerStart - qrBoxHeight - 3;

    doc.setFillColor(...COLORS.lightGray);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, qrBoxHeight, 2, 2, 'F');

    // QR Code - compact
    if (mainQRCode) {
      doc.addImage(mainQRCode, 'PNG', MARGIN + 2, y + 1, 16, 16);
    }

    // Link info - compact
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('View Online Gallery', MARGIN + 20, y + 7);

    doc.setTextColor(...COLORS.primary);
    doc.setFontSize(6);
    doc.textWithLink(shareUrl, MARGIN + 20, y + 12, { url: shareUrl });

    doc.setTextColor(...COLORS.gray);
    doc.setFontSize(6);
    doc.text('Scan QR code or click link to view photos online', MARGIN + 20, y + 16);
  }

  drawSimpleFooter(doc, shareUrl);

  // ============================================
  // PHOTO PAGES (COMPACT - 6 photos per page)
  // ============================================

  if (photos.length > 0) {
    const photosPerPage = 6;
    const cols = 2;
    const photoWidth = (CONTENT_WIDTH - 8) / cols;
    const photoHeight = 70;
    const captionHeight = 12;
    const gapX = 8;
    const gapY = 6;
    const startY = 26; // After compact header
    const maxY = PAGE_HEIGHT - 20; // Before footer

    for (let pageStart = 0; pageStart < photos.length; pageStart += photosPerPage) {
      doc.addPage();
      currentPage++;

      drawHeader(doc, projectName, vehicle?.vehicle_code || '-', currentPage, totalPages);

      doc.setTextColor(...COLORS.dark);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('PHOTOS', MARGIN, startY - 2);

      const pagePhotos = photos.slice(pageStart, pageStart + photosPerPage);

      for (let i = 0; i < pagePhotos.length; i++) {
        const photo = pagePhotos[i];
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = MARGIN + (col * (photoWidth + gapX));
        const y = startY + (row * (photoHeight + captionHeight + gapY));

        // Skip if would exceed page
        if (y + photoHeight + captionHeight > maxY) continue;

        // Photo frame
        doc.setFillColor(...COLORS.lightGray);
        doc.roundedRect(x, y, photoWidth, photoHeight + captionHeight, 2, 2, 'F');

        // Load and add photo with proper aspect ratio
        try {
          const imgResult = await loadImageAsDataURL(photo.file_url);
          if (imgResult) {
            const boxW = photoWidth - 2;
            const boxH = photoHeight - 2;
            const fit = calculateFitDimensions(imgResult.width, imgResult.height, boxW, boxH);
            doc.addImage(
              imgResult.dataUrl,
              'JPEG',
              x + 1 + fit.offsetX,
              y + 1 + fit.offsetY,
              fit.width,
              fit.height,
              undefined,
              'MEDIUM'
            );
          }
        } catch {
          doc.setTextColor(...COLORS.gray);
          doc.setFontSize(8);
          doc.text('Photo not available', x + photoWidth / 2, y + photoHeight / 2, { align: 'center' });
        }

        // Caption - compact single line
        doc.setTextColor(...COLORS.dark);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        const caption = getPhotoTypeLabelEnglish(photo.photo_type || 'general');
        const photoDate = new Date(photo.uploaded_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
        doc.text(`${caption} - ${photoDate}`, x + 3, y + photoHeight + 7);
      }

      drawSimpleFooter(doc, shareUrl);
    }
  }

  // Return as blob
  return doc.output('blob');
}

/**
 * Download the PDF
 */
export async function downloadDeliveryReportPDF(data: DeliveryReportData): Promise<void> {
  const blob = await generateDeliveryReportPDF(data);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Delivery_Report_${data.vehicle?.vehicle_code || 'Unknown'}_${data.arrivedVehicle.arrival_date}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
