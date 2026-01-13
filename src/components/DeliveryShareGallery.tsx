/**
 * Public Delivery Share Gallery
 *
 * A professional, English-language page for sharing delivery reports
 * with clients and stakeholders. Accessible via secure share links.
 */

import { useState, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import {
  DeliveryShareLink,
  ArrivedVehicle,
  DeliveryVehicle,
  DeliveryItem,
  ArrivalItemConfirmation,
  ArrivalPhoto,
  ArrivalItemStatus
} from '../supabase';
import {
  getShareLinkByToken,
  formatDateEnglish,
  formatTime,
  getStatusLabelEnglish,
  getPhotoTypeLabelEnglish
} from '../utils/shareUtils';
import {
  FiCheck,
  FiX,
  FiAlertTriangle,
  FiPlus,
  FiDownload,
  FiImage,
  FiTruck,
  FiCalendar,
  FiClock,
  FiPackage,
  FiLoader,
  FiChevronLeft,
  FiChevronRight,
  FiMaximize2,
  FiFileText
} from 'react-icons/fi';
import * as XLSX from 'xlsx-js-style';

interface DeliveryShareGalleryProps {
  token: string;
}

// Status icon component
function StatusIcon({ status }: { status: ArrivalItemStatus }) {
  switch (status) {
    case 'confirmed':
      return <FiCheck className="status-icon confirmed" />;
    case 'missing':
      return <FiX className="status-icon missing" />;
    case 'added':
      return <FiPlus className="status-icon added" />;
    case 'wrong_vehicle':
      return <FiAlertTriangle className="status-icon warning" />;
    default:
      return <FiClock className="status-icon pending" />;
  }
}

export default function DeliveryShareGallery({ token }: DeliveryShareGalleryProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<DeliveryShareLink | null>(null);
  const [arrivedVehicle, setArrivedVehicle] = useState<(ArrivedVehicle & { vehicle?: DeliveryVehicle }) | null>(null);
  const [confirmations, setConfirmations] = useState<ArrivalItemConfirmation[]>([]);
  const [photos, setPhotos] = useState<ArrivalPhoto[]>([]);
  const [items, setItems] = useState<DeliveryItem[]>([]);

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const result = await getShareLinkByToken(token);

      if (result.error) {
        setError(result.error);
      } else {
        setShareLink(result.shareLink);
        setArrivedVehicle(result.arrivedVehicle);
        setConfirmations(result.confirmations);
        setPhotos(result.photos);
        setItems(result.items);
      }
      setLoading(false);
    }

    loadData();
  }, [token]);

  // Calculate stats
  const confirmedCount = confirmations.filter(c => c.status === 'confirmed').length;
  const missingCount = confirmations.filter(c => c.status === 'missing').length;
  const addedCount = confirmations.filter(c => c.status === 'added').length;
  const pendingCount = confirmations.filter(c => c.status === 'pending').length;
  const totalWeight = items.reduce((sum, item) => sum + (Number(item.cast_unit_weight) || 0), 0);

  // Get item status
  const getItemStatus = useCallback((itemId: string): ArrivalItemStatus => {
    const conf = confirmations.find(c => c.item_id === itemId);
    return conf?.status || 'pending';
  }, [confirmations]);

  // Get item comment
  const getItemComment = useCallback((itemId: string): string | null => {
    const conf = confirmations.find(c => c.item_id === itemId);
    return conf?.notes || null;
  }, [confirmations]);

  // Download all photos as ZIP
  const downloadAllPhotos = async () => {
    if (photos.length === 0) return;

    setDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('photos');

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const response = await fetch(photo.file_url);
          const blob = await response.blob();
          const extension = photo.file_name?.split('.').pop() || 'jpg';
          const fileName = `${i + 1}_${photo.photo_type || 'photo'}_${photo.file_name || `photo.${extension}`}`;
          folder?.file(fileName, blob);
        } catch (e) {
          console.error('Error downloading photo:', e);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${shareLink?.vehicle_code || 'delivery'}_photos.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error creating ZIP:', e);
    } finally {
      setDownloading(false);
    }
  };

  // Download items as Excel
  const downloadExcel = () => {
    if (items.length === 0) return;

    // Sort items alphabetically
    const sortedItems = [...items].sort((a, b) =>
      (a.assembly_mark || '').localeCompare(b.assembly_mark || '', 'en')
    );

    // Create worksheet data
    const wsData = [
      // Header row
      ['#', 'Mark', 'Product', 'Weight (kg)', 'Status', 'Comment', 'GUID']
    ];

    // Data rows
    sortedItems.forEach((item, idx) => {
      const status = getItemStatus(item.id);
      const comment = getItemComment(item.id);
      wsData.push([
        (idx + 1).toString(),
        item.assembly_mark || '-',
        item.product_name || '-',
        item.cast_unit_weight ? Math.round(Number(item.cast_unit_weight)).toString() : '-',
        getStatusLabelEnglish(status),
        comment || '-',
        item.guid_ifc || item.guid || '-'
      ]);
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = [
      { wch: 5 },   // #
      { wch: 15 },  // Mark
      { wch: 25 },  // Product
      { wch: 12 },  // Weight
      { wch: 12 },  // Status
      { wch: 30 },  // Comment
      { wch: 40 }   // GUID
    ];

    // Style header row
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    for (let i = 0; i < 7; i++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[cellRef]) {
        ws[cellRef].s = headerStyle;
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Delivery Items');

    // Download
    const fileName = `${shareLink?.vehicle_code || 'delivery'}_${arrivedVehicle?.arrival_date || 'items'}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Lightbox navigation
  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const nextPhoto = () => {
    setLightboxIndex((prev) => (prev + 1) % photos.length);
  };

  const prevPhoto = () => {
    setLightboxIndex((prev) => (prev - 1 + photos.length) % photos.length);
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') nextPhoto();
      if (e.key === 'ArrowLeft') prevPhoto();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen]);

  // Loading state
  if (loading) {
    return (
      <div className="share-gallery-loading">
        <FiLoader className="spinner" />
        <p>Loading delivery report...</p>
      </div>
    );
  }

  // Error state
  if (error || !shareLink || !arrivedVehicle) {
    return (
      <div className="share-gallery-error">
        <FiAlertTriangle size={48} />
        <h1>Report Not Available</h1>
        <p>{error || 'This share link is invalid or has expired.'}</p>
      </div>
    );
  }

  const vehicle = arrivedVehicle.vehicle;

  return (
    <div className="share-gallery">
      {/* Header */}
      <header className="share-gallery-header">
        <div className="header-content">
          <div className="project-badge">
            <FiPackage />
            <span>{shareLink.project_name}</span>
          </div>
          <h1>Delivery Report</h1>
          <p className="subtitle">
            <FiTruck /> Vehicle {vehicle?.vehicle_code || '-'}
            <span className="separator">|</span>
            <FiCalendar /> {formatDateEnglish(arrivedVehicle.arrival_date)}
          </p>
        </div>
      </header>

      <main className="share-gallery-main">
        {/* Summary Section */}
        <section className="summary-section compact">
          <h2>Delivery Summary</h2>

          {/* Status badges - compact row at top */}
          <div className="status-badges compact">
            <div className="badge confirmed">
              <FiCheck />
              <span className="count">{confirmedCount}</span>
              <span className="label">Confirmed</span>
            </div>
            <div className="badge missing">
              <FiX />
              <span className="count">{missingCount}</span>
              <span className="label">Missing</span>
            </div>
            <div className="badge pending">
              <FiClock />
              <span className="count">{pendingCount}</span>
              <span className="label">Pending</span>
            </div>
            <div className="badge added">
              <FiPlus />
              <span className="count">{addedCount}</span>
              <span className="label">Added</span>
            </div>
          </div>

          <div className="summary-grid compact">
            <div className="summary-item">
              <span className="label">Scheduled</span>
              <span className="value">{vehicle?.scheduled_date ? formatDateEnglish(vehicle.scheduled_date) : '-'}</span>
            </div>
            <div className="summary-item">
              <span className="label">Arrival</span>
              <span className="value">{formatDateEnglish(arrivedVehicle.arrival_date)} {formatTime(arrivedVehicle.arrival_time)}</span>
            </div>
            <div className="summary-item">
              <span className="label">Unload</span>
              <span className="value">{formatTime(arrivedVehicle.unload_start_time)} - {formatTime(arrivedVehicle.unload_end_time)}</span>
            </div>
            <div className="summary-item">
              <span className="label">Items</span>
              <span className="value">{items.length} ({Math.round(totalWeight).toLocaleString()} kg)</span>
            </div>
            {arrivedVehicle.reg_number && (
              <div className="summary-item">
                <span className="label">Reg. Number</span>
                <span className="value">{arrivedVehicle.reg_number}</span>
              </div>
            )}
            {arrivedVehicle.trailer_number && (
              <div className="summary-item">
                <span className="label">Trailer</span>
                <span className="value">{arrivedVehicle.trailer_number}</span>
              </div>
            )}
            {arrivedVehicle.unload_location && (
              <div className="summary-item">
                <span className="label">Location</span>
                <span className="value">{arrivedVehicle.unload_location}</span>
              </div>
            )}
            {arrivedVehicle.checked_by_workers && (
              <div className="summary-item">
                <span className="label">Inspectors</span>
                <span className="value">{arrivedVehicle.checked_by_workers}</span>
              </div>
            )}
          </div>

          {/* Unload Resources */}
          {(() => {
            const res = arrivedVehicle.unload_resources as Record<string, string | number> | null;
            if (!res) return null;
            const hasResources = ['crane', 'forklift', 'poomtostuk', 'manual', 'workforce'].some(k => Number(res[k]) > 0);
            if (!hasResources) return null;
            return (
              <div className="resources-section">
                <span className="resources-label">Resources:</span>
                <div className="resources-list">
                  {Number(res.crane) > 0 && (
                    <span className="resource-badge">Crane ×{res.crane}{res.crane_name ? `: ${res.crane_name}` : ''}</span>
                  )}
                  {Number(res.forklift) > 0 && (
                    <span className="resource-badge">Telehandler ×{res.forklift}{res.forklift_name ? `: ${res.forklift_name}` : ''}</span>
                  )}
                  {Number(res.poomtostuk) > 0 && (
                    <span className="resource-badge">Boom Lift ×{res.poomtostuk}{res.poomtostuk_name ? `: ${res.poomtostuk_name}` : ''}</span>
                  )}
                  {Number(res.manual) > 0 && (
                    <span className="resource-badge">Manual</span>
                  )}
                  {Number(res.workforce) > 0 && (
                    <span className="resource-badge">Workers ×{res.workforce}{res.workforce_workers ? `: ${res.workforce_workers}` : ''}</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Notes */}
          {arrivedVehicle.notes && (
            <div className="vehicle-notes">
              <span className="notes-label">Notes:</span>
              <span className="notes-text">{arrivedVehicle.notes}</span>
            </div>
          )}
        </section>

        {/* Items Section */}
        <section className="items-section">
          <div className="section-header">
            <h2>Items ({items.length})</h2>
            <button className="download-excel-btn" onClick={downloadExcel}>
              <FiFileText /> Download Excel
            </button>
          </div>
          <div className="items-table-wrapper">
            <table className="items-table compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Mark</th>
                  <th>Weight</th>
                  <th>Status</th>
                  <th>Comment</th>
                  <th>GUID</th>
                </tr>
              </thead>
              <tbody>
                {[...items]
                  .sort((a, b) => (a.assembly_mark || '').localeCompare(b.assembly_mark || '', 'en'))
                  .map((item, idx) => {
                  const status = getItemStatus(item.id);
                  const comment = getItemComment(item.id);
                  return (
                    <tr key={item.id} className={status}>
                      <td className="num">{idx + 1}</td>
                      <td className="mark">{item.assembly_mark || '-'}</td>
                      <td className="weight">
                        {item.cast_unit_weight ? `${Math.round(Number(item.cast_unit_weight))} kg` : '-'}
                      </td>
                      <td className="status">
                        <div className={`status-cell ${status}`}>
                          <StatusIcon status={status} />
                          <span>{getStatusLabelEnglish(status)}</span>
                        </div>
                      </td>
                      <td className="comment">{comment || '-'}</td>
                      <td className="guid">{item.guid_ifc || item.guid || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Photos Section */}
        {photos.length > 0 && (
          <section className="photos-section">
            <div className="section-header">
              <h2>
                <FiImage /> Photos ({photos.length})
              </h2>
              <button
                className="download-all-btn"
                onClick={downloadAllPhotos}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <FiLoader className="spinner" /> Downloading...
                  </>
                ) : (
                  <>
                    <FiDownload /> Download All
                  </>
                )}
              </button>
            </div>
            <div className="photos-grid">
              {photos.map((photo, idx) => (
                <div key={photo.id} className="photo-card" onClick={() => openLightbox(idx)}>
                  <div className="photo-wrapper">
                    <img src={photo.file_url} alt={photo.file_name || 'Photo'} loading="lazy" />
                    <div className="photo-overlay">
                      <FiMaximize2 />
                    </div>
                  </div>
                  <div className="photo-info">
                    <span className="photo-type">{getPhotoTypeLabelEnglish(photo.photo_type || 'general')}</span>
                    <span className="photo-date">
                      {new Date(photo.uploaded_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Notes Section */}
        {confirmations.some(c => c.notes) && (
          <section className="notes-section">
            <h2>Notes & Comments</h2>
            <div className="notes-list">
              {confirmations
                .filter(c => c.notes)
                .map(conf => {
                  const item = items.find(i => i.id === conf.item_id);
                  return (
                    <div key={conf.id} className="note-item">
                      <span className="note-mark">{item?.assembly_mark || '-'}</span>
                      <span className="note-text">{conf.notes}</span>
                    </div>
                  );
                })}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="share-gallery-footer">
        <div className="footer-content">
          <p>
            This delivery report was generated for {shareLink.project_name}.
            <br />
            For questions, please contact the project manager.
          </p>
          <p className="view-count">
            This report has been viewed {shareLink.view_count} time{shareLink.view_count !== 1 ? 's' : ''}.
          </p>
        </div>
      </footer>

      {/* Lightbox */}
      {lightboxOpen && photos[lightboxIndex] && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={closeLightbox}>
              <FiX />
            </button>

            <button className="lightbox-nav prev" onClick={prevPhoto}>
              <FiChevronLeft />
            </button>

            <div className="lightbox-image-wrapper">
              <img src={photos[lightboxIndex].file_url} alt="" />
              <div className="lightbox-caption">
                <span className="photo-type">
                  {getPhotoTypeLabelEnglish(photos[lightboxIndex].photo_type || 'general')}
                </span>
                <span className="photo-counter">
                  {lightboxIndex + 1} / {photos.length}
                </span>
              </div>
            </div>

            <button className="lightbox-nav next" onClick={nextPhoto}>
              <FiChevronRight />
            </button>

            <a
              href={photos[lightboxIndex].file_url}
              download
              className="lightbox-download"
              onClick={(e) => e.stopPropagation()}
            >
              <FiDownload /> Download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
