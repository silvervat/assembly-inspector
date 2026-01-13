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
const MARGIN = 15;
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
 * Draw page header
 */
function drawHeader(
  doc: jsPDF,
  projectName: string,
  vehicleCode: string,
  pageNum: number,
  totalPages: number
): void {
  // Header background
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, PAGE_WIDTH, 25, 'F');

  // Project name
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(projectName, MARGIN, 12);

  // Vehicle code
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Vehicle: ${vehicleCode}`, MARGIN, 20);

  // Page number
  doc.text(`Page ${pageNum} / ${totalPages}`, PAGE_WIDTH - MARGIN, 12, { align: 'right' });

  // Title
  doc.text('DELIVERY REPORT', PAGE_WIDTH - MARGIN, 20, { align: 'right' });
}

/**
 * Draw page footer
 */
function drawFooter(doc: jsPDF, shareUrl: string, qrDataUrl: string): void {
  const footerY = PAGE_HEIGHT - 25;

  // Footer line
  doc.setDrawColor(...COLORS.lightGray);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, footerY - 5, PAGE_WIDTH - MARGIN, footerY - 5);

  // QR Code (small)
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', MARGIN, footerY - 3, 18, 18);
  }

  // URL text
  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(8);
  doc.text('View online:', MARGIN + 22, footerY + 2);
  doc.setTextColor(...COLORS.primary);
  doc.textWithLink(shareUrl, MARGIN + 22, footerY + 7, { url: shareUrl });

  // Generation date
  doc.setTextColor(...COLORS.gray);
  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.text(`Generated: ${generatedDate}`, PAGE_WIDTH - MARGIN, footerY + 7, { align: 'right' });
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
  // PAGE 1: OVERVIEW
  // ============================================

  drawHeader(doc, projectName, vehicle?.vehicle_code || '-', currentPage, totalPages);

  let y = 35;

  // Title
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Delivery Confirmation Report', MARGIN, y);
  y += 12;

  // Subtitle
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  const factoryText = factory?.factory_name ? ` (${factory.factory_name})` : '';
  doc.text(`Vehicle ${vehicle?.vehicle_code || '-'}${factoryText} - ${formatDateEnglish(arrivedVehicle.arrival_date)}`, MARGIN, y);
  y += 15;

  // Summary Box
  doc.setFillColor(...COLORS.lightGray);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 45, 3, 3, 'F');

  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('DELIVERY SUMMARY', MARGIN + 5, y + 8);

  // Summary grid
  const summaryData = [
    ['Scheduled Date:', vehicle?.scheduled_date ? formatDateEnglish(vehicle.scheduled_date) : '-'],
    ['Arrival Date:', formatDateEnglish(arrivedVehicle.arrival_date)],
    ['Arrival Time:', formatTime(arrivedVehicle.arrival_time)],
    ['Total Items:', `${items.length}`],
    ['Total Weight:', `${Math.round(totalWeight).toLocaleString()} kg`],
    ['Status:', arrivedVehicle.is_confirmed ? 'CONFIRMED' : 'In Progress']
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const col1X = MARGIN + 5;
  const col2X = MARGIN + 50;
  const col3X = MARGIN + 95;
  const col4X = MARGIN + 140;

  doc.setTextColor(...COLORS.gray);
  doc.text(summaryData[0][0], col1X, y + 18);
  doc.text(summaryData[1][0], col1X, y + 26);
  doc.text(summaryData[2][0], col1X, y + 34);

  doc.setTextColor(...COLORS.dark);
  doc.setFont('helvetica', 'bold');
  doc.text(summaryData[0][1], col2X, y + 18);
  doc.text(summaryData[1][1], col2X, y + 26);
  doc.text(summaryData[2][1], col2X, y + 34);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.gray);
  doc.text(summaryData[3][0], col3X, y + 18);
  doc.text(summaryData[4][0], col3X, y + 26);
  doc.text(summaryData[5][0], col3X, y + 34);

  doc.setTextColor(...COLORS.dark);
  doc.setFont('helvetica', 'bold');
  doc.text(summaryData[3][1], col4X, y + 18);
  doc.text(summaryData[4][1], col4X, y + 26);
  if (arrivedVehicle.is_confirmed) {
    doc.setTextColor(...COLORS.success);
  }
  doc.text(summaryData[5][1], col4X, y + 34);

  y += 55;

  // Status summary badges
  doc.setFontSize(10);

  // Confirmed badge
  doc.setFillColor(...COLORS.success);
  doc.roundedRect(MARGIN, y, 55, 20, 2, 2, 'F');
  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIRMED', MARGIN + 27.5, y + 8, { align: 'center' });
  doc.setFontSize(14);
  doc.text(`${confirmedCount}`, MARGIN + 27.5, y + 16, { align: 'center' });

  // Missing badge
  doc.setFillColor(...COLORS.danger);
  doc.roundedRect(MARGIN + 60, y, 55, 20, 2, 2, 'F');
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(10);
  doc.text('MISSING', MARGIN + 87.5, y + 8, { align: 'center' });
  doc.setFontSize(14);
  doc.text(`${missingCount}`, MARGIN + 87.5, y + 16, { align: 'center' });

  // Added badge
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(MARGIN + 120, y, 55, 20, 2, 2, 'F');
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(10);
  doc.text('ADDED', MARGIN + 147.5, y + 8, { align: 'center' });
  doc.setFontSize(14);
  doc.text(`${addedCount}`, MARGIN + 147.5, y + 16, { align: 'center' });

  y += 30;

  // Items Table
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('ITEMS', MARGIN, y);
  y += 5;

  // Prepare table data
  const tableData = items.map((item, idx) => {
    const conf = confirmations.find(c => c.item_id === item.id);
    const status = conf?.status || 'pending';
    return [
      (idx + 1).toString(),
      item.assembly_mark || '-',
      item.product_name || '-',
      item.cast_unit_weight ? `${Math.round(Number(item.cast_unit_weight))} kg` : '-',
      getStatusLabelEnglish(status)
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Mark', 'Product', 'Weight', 'Status']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: COLORS.dark,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 8,
      textColor: COLORS.dark
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 35 },
      2: { cellWidth: 60 },
      3: { cellWidth: 25 },
      4: { cellWidth: 25 }
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      // Color status column
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
    }
  });

  // Get final Y position after table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10;

  // Comments section if there's space
  const commentsWithText = confirmations.filter(c => c.notes && c.notes.trim());
  if (commentsWithText.length > 0 && y < PAGE_HEIGHT - 80) {
    doc.setTextColor(...COLORS.dark);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('COMMENTS', MARGIN, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.gray);

    for (const conf of commentsWithText.slice(0, 5)) {
      const item = items.find(i => i.id === conf.item_id);
      const text = `${item?.assembly_mark || '-'}: ${conf.notes}`;
      const lines = doc.splitTextToSize(text, CONTENT_WIDTH);
      doc.text(lines, MARGIN, y);
      y += lines.length * 4 + 2;
      if (y > PAGE_HEIGHT - 60) break;
    }
  }

  // QR Code and link at bottom of first page
  if (y < PAGE_HEIGHT - 70) {
    y = PAGE_HEIGHT - 70;
  }

  doc.setFillColor(...COLORS.lightGray);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 35, 3, 3, 'F');

  // QR Code
  if (mainQRCode) {
    doc.addImage(mainQRCode, 'PNG', MARGIN + 5, y + 2, 31, 31);
  }

  // Link info
  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('View Full Report Online', MARGIN + 42, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.gray);
  doc.text('Scan QR code or visit:', MARGIN + 42, y + 20);

  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(8);
  doc.textWithLink(shareUrl, MARGIN + 42, y + 27, { url: shareUrl });

  drawFooter(doc, shareUrl, footerQRCode);

  // ============================================
  // PHOTO PAGES
  // ============================================

  if (photos.length > 0) {
    const photosPerPage = 4;
    const photoWidth = (CONTENT_WIDTH - 10) / 2;
    const photoHeight = 80;

    for (let pageStart = 0; pageStart < photos.length; pageStart += photosPerPage) {
      doc.addPage();
      currentPage++;

      drawHeader(doc, projectName, vehicle?.vehicle_code || '-', currentPage, totalPages);

      doc.setTextColor(...COLORS.dark);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('PHOTO DOCUMENTATION', MARGIN, 38);

      const pagePhotos = photos.slice(pageStart, pageStart + photosPerPage);

      for (let i = 0; i < pagePhotos.length; i++) {
        const photo = pagePhotos[i];
        const row = Math.floor(i / 2);
        const col = i % 2;
        const x = MARGIN + (col * (photoWidth + 10));
        const y = 45 + (row * (photoHeight + 25));

        // Photo frame
        doc.setFillColor(...COLORS.lightGray);
        doc.roundedRect(x, y, photoWidth, photoHeight + 18, 2, 2, 'F');

        // Load and add photo
        try {
          const imgData = await loadImageAsDataURL(photo.file_url);
          if (imgData) {
            // Calculate aspect ratio to fit
            doc.addImage(imgData, 'JPEG', x + 2, y + 2, photoWidth - 4, photoHeight - 4, undefined, 'MEDIUM');
          }
        } catch {
          // Draw placeholder
          doc.setTextColor(...COLORS.gray);
          doc.setFontSize(10);
          doc.text('Photo not available', x + photoWidth / 2, y + photoHeight / 2, { align: 'center' });
        }

        // Photo caption
        doc.setTextColor(...COLORS.dark);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        const caption = getPhotoTypeLabelEnglish(photo.photo_type || 'general');
        doc.text(caption, x + 5, y + photoHeight + 5);

        // Photo date/time
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.gray);
        const photoDate = new Date(photo.uploaded_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
        doc.text(photoDate, x + 5, y + photoHeight + 11);

        // Small QR code for individual photo
        const photoQR = await generateQRCode(photo.file_url, 60);
        if (photoQR) {
          doc.addImage(photoQR, 'PNG', x + photoWidth - 18, y + photoHeight + 1, 15, 15);
        }
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
