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

/**
 * Load image as data URL
 */
async function loadImageAsDataURL(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
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
 * Draw page footer (compact)
 */
function drawFooter(doc: jsPDF, shareUrl: string, qrDataUrl: string): void {
  const footerY = PAGE_HEIGHT - 15;

  // Footer line
  doc.setDrawColor(...COLORS.lightGray);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY - 3, PAGE_WIDTH - MARGIN, footerY - 3);

  // QR Code (tiny)
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', MARGIN, footerY - 1, 12, 12);
  }

  // URL text
  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(7);
  doc.textWithLink(shareUrl, MARGIN + 14, footerY + 4, { url: shareUrl });

  // Generation date
  doc.setTextColor(...COLORS.gray);
  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.text(`Generated: ${generatedDate}`, PAGE_WIDTH - MARGIN, footerY + 4, { align: 'right' });
}

/**
 * Generate the complete PDF report
 */
export async function generateDeliveryReportPDF(data: DeliveryReportData): Promise<Blob> {
  const { projectName, vehicle, factory, arrivedVehicle, items, confirmations, photos, shareUrl } = data;

  // Pre-generate QR codes
  const mainQRCode = await generateQRCode(shareUrl, 150);
  const footerQRCode = await generateQRCode(shareUrl, 80);

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

  // Vehicle notes (if any)
  if (arrivedVehicle.notes && arrivedVehicle.notes.trim()) {
    doc.setFillColor(255, 251, 235); // Light yellow background
    const noteLines = doc.splitTextToSize(`Vehicle notes: ${arrivedVehicle.notes}`, CONTENT_WIDTH - 6);
    const noteHeight = noteLines.length * 4 + 4;
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, noteHeight, 2, 2, 'F');
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(8);
    doc.text(noteLines, MARGIN + 3, y + 5);
    y += noteHeight + 3;
  }

  // Status badges - compact inline
  const badgeWidth = 45;
  const badgeHeight = 14;
  doc.setFontSize(8);

  // Confirmed badge
  doc.setFillColor(...COLORS.success);
  doc.roundedRect(MARGIN, y, badgeWidth, badgeHeight, 2, 2, 'F');
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.text(`CONFIRMED: ${confirmedCount}`, MARGIN + badgeWidth/2, y + 9, { align: 'center' });

  // Missing badge
  doc.setFillColor(...COLORS.danger);
  doc.roundedRect(MARGIN + badgeWidth + 5, y, badgeWidth, badgeHeight, 2, 2, 'F');
  doc.text(`MISSING: ${missingCount}`, MARGIN + badgeWidth + 5 + badgeWidth/2, y + 9, { align: 'center' });

  // Added badge
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(MARGIN + (badgeWidth + 5) * 2, y, badgeWidth, badgeHeight, 2, 2, 'F');
  doc.text(`ADDED: ${addedCount}`, MARGIN + (badgeWidth + 5) * 2 + badgeWidth/2, y + 9, { align: 'center' });

  y += badgeHeight + 5;

  // Items Table - compact with GUID and Notes
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('ITEMS', MARGIN, y);
  y += 3;

  // Prepare table data with GUID and Notes
  const tableData = items.map((item, idx) => {
    const conf = confirmations.find(c => c.item_id === item.id);
    const status = conf?.status || 'pending';
    const notes = conf?.notes || '';
    // Truncate GUID for display (first 8 chars)
    const guidShort = item.guid_ifc ? item.guid_ifc.substring(0, 8) + '...' : '-';
    return [
      (idx + 1).toString(),
      item.assembly_mark || '-',
      guidShort,
      item.cast_unit_weight ? `${Math.round(Number(item.cast_unit_weight))}` : '-',
      getStatusLabelEnglish(status),
      notes
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Mark', 'GUID', 'kg', 'Status', 'Notes']],
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
      fontSize: 7,
      textColor: COLORS.dark,
      cellPadding: 1.5
    },
    columnStyles: {
      0: { cellWidth: 8 },   // #
      1: { cellWidth: 28 },  // Mark
      2: { cellWidth: 22 },  // GUID
      3: { cellWidth: 12 },  // Weight
      4: { cellWidth: 18 },  // Status
      5: { cellWidth: 'auto' } // Notes - takes remaining space
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      // Color status column (index 4)
      if (data.column.index === 4 && data.section === 'body') {
        const status = tableData[data.row.index]?.[4] || '';
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
      // Notes column styling (index 5)
      if (data.column.index === 5 && data.section === 'body') {
        data.cell.styles.textColor = COLORS.gray;
        data.cell.styles.fontSize = 6;
      }
    }
  });

  // Get final Y position after table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 5;

  // QR Code and link - compact box at bottom (only if space available)
  const qrBoxHeight = 22;
  const footerStart = PAGE_HEIGHT - 15; // Where footer starts

  if (y < footerStart - qrBoxHeight - 5) {
    // Position QR box just above footer
    y = footerStart - qrBoxHeight - 5;

    doc.setFillColor(...COLORS.lightGray);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, qrBoxHeight, 2, 2, 'F');

    // QR Code - compact
    if (mainQRCode) {
      doc.addImage(mainQRCode, 'PNG', MARGIN + 2, y + 1, 20, 20);
    }

    // Link info - compact
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('View Online Gallery', MARGIN + 25, y + 8);

    doc.setTextColor(...COLORS.primary);
    doc.setFontSize(7);
    doc.textWithLink(shareUrl, MARGIN + 25, y + 14, { url: shareUrl });

    doc.setTextColor(...COLORS.gray);
    doc.setFontSize(7);
    doc.text('Scan QR or click link', MARGIN + 25, y + 19);
  }

  drawFooter(doc, shareUrl, footerQRCode);

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

        // Load and add photo
        try {
          const imgData = await loadImageAsDataURL(photo.file_url);
          if (imgData) {
            doc.addImage(imgData, 'JPEG', x + 1, y + 1, photoWidth - 2, photoHeight - 2, undefined, 'MEDIUM');
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

      drawFooter(doc, shareUrl, footerQRCode);
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
