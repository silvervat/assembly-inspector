import { useState, useCallback, useEffect, useRef } from 'react';
import { FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiInfo, FiChevronLeft } from 'react-icons/fi';

export interface InspectionItem {
  id: string;
  assembly_mark: string;
  model_id: string;
  object_runtime_id: number;
  inspector_name: string;
  inspected_at: string;
  photo_urls?: string[];
  user_photos?: string[];
  snapshot_3d_url?: string;
  topview_url?: string;
  guid?: string;
  guid_ifc?: string;
  file_name?: string;
  user_email?: string;
}

interface InspectionListProps {
  inspections: InspectionItem[];
  mode: 'mine' | 'all';
  totalCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  onZoomToInspection: (inspection: InspectionItem) => void;
  onSelectInspection: (inspection: InspectionItem) => void;
  onSelectGroup: (inspections: InspectionItem[]) => void;
  onZoomToGroup: (inspections: InspectionItem[]) => void;
  onLoadMore: () => void;
  onClose: () => void;
}

// Get month key for grouping (e.g., "2025-12")
function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Get month label (e.g., "Detsember 2025")
function getMonthLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('et-EE', {
    year: 'numeric',
    month: 'long'
  });
}

// Get day key for grouping (e.g., "2025-12-16")
function getDayKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Get day label (e.g., "16. detsember")
function getDayLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('et-EE', {
    day: 'numeric',
    month: 'long'
  });
}

// Group inspections by month, then by day
interface MonthGroup {
  monthKey: string;
  monthLabel: string;
  days: DayGroup[];
  allItems: InspectionItem[];
}

interface DayGroup {
  dayKey: string;
  dayLabel: string;
  items: InspectionItem[];
}

function groupByMonthAndDay(inspections: InspectionItem[]): MonthGroup[] {
  const monthMap: Record<string, MonthGroup> = {};

  for (const insp of inspections) {
    const monthKey = getMonthKey(insp.inspected_at);
    const dayKey = getDayKey(insp.inspected_at);

    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        monthKey,
        monthLabel: getMonthLabel(insp.inspected_at),
        days: [],
        allItems: []
      };
    }

    monthMap[monthKey].allItems.push(insp);

    // Find or create day group
    let dayGroup = monthMap[monthKey].days.find(d => d.dayKey === dayKey);
    if (!dayGroup) {
      dayGroup = {
        dayKey,
        dayLabel: getDayLabel(insp.inspected_at),
        items: []
      };
      monthMap[monthKey].days.push(dayGroup);
    }
    dayGroup.items.push(insp);
  }

  // Sort months descending, days descending within each month
  const sortedMonths = Object.values(monthMap).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  for (const month of sortedMonths) {
    month.days.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }

  return sortedMonths;
}

export default function InspectionList({
  inspections,
  mode,
  totalCount,
  hasMore,
  loadingMore,
  onZoomToInspection,
  onSelectInspection,
  onSelectGroup,
  onZoomToGroup,
  onLoadMore,
  onClose
}: InspectionListProps) {
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [selectedInspection, setSelectedInspection] = useState<InspectionItem | null>(null);
  const [modalGallery, setModalGallery] = useState<{ photos: string[], currentIndex: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // Gallery navigation functions
  const openGallery = useCallback((photos: string[], startIndex: number) => {
    setModalGallery({ photos, currentIndex: startIndex });
  }, []);

  const closeGallery = useCallback(() => {
    setModalGallery(null);
  }, []);

  const nextPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex < modalGallery.photos.length - 1) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex + 1 } : null);
    }
  }, [modalGallery]);

  const prevPhoto = useCallback(() => {
    if (modalGallery && modalGallery.currentIndex > 0) {
      setModalGallery(prev => prev ? { ...prev, currentIndex: prev.currentIndex - 1 } : null);
    }
  }, [modalGallery]);

  // Keyboard handler for gallery
  useEffect(() => {
    if (!modalGallery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeGallery();
      } else if (e.key === 'ArrowRight') {
        nextPhoto();
      } else if (e.key === 'ArrowLeft') {
        prevPhoto();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalGallery, closeGallery, nextPhoto, prevPhoto]);

  // Touch handlers for swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;

    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;

    if (Math.abs(diff) > minSwipeDistance) {
      if (diff > 0) {
        nextPhoto();
      } else {
        prevPhoto();
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  const monthGroups = groupByMonthAndDay(inspections);
  const hasMultipleMonths = monthGroups.length > 1;

  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths);
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey);
    } else {
      newExpanded.add(monthKey);
    }
    setExpandedMonths(newExpanded);
  };

  const toggleDay = (dayKey: string) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(dayKey)) {
      newExpanded.delete(dayKey);
    } else {
      newExpanded.add(dayKey);
    }
    setExpandedDays(newExpanded);
  };

  // Handle month click - select all items in month
  const handleMonthClick = (month: MonthGroup) => {
    setSelectedIds(new Set(month.allItems.map(item => item.id)));
    onSelectGroup(month.allItems);
    // Expand the month
    if (!expandedMonths.has(month.monthKey)) {
      toggleMonth(month.monthKey);
    }
  };

  // Handle month zoom
  const handleMonthZoom = (e: React.MouseEvent, month: MonthGroup) => {
    e.stopPropagation();
    setSelectedIds(new Set(month.allItems.map(item => item.id)));
    onZoomToGroup(month.allItems);
  };

  // Handle day click - select all items in day
  const handleDayClick = (day: DayGroup) => {
    setSelectedIds(new Set(day.items.map(item => item.id)));
    onSelectGroup(day.items);
    // Expand the day
    if (!expandedDays.has(day.dayKey)) {
      toggleDay(day.dayKey);
    }
  };

  // Handle day zoom
  const handleDayZoom = (e: React.MouseEvent, day: DayGroup) => {
    e.stopPropagation();
    setSelectedIds(new Set(day.items.map(item => item.id)));
    onZoomToGroup(day.items);
  };

  // Handle single inspection zoom
  const handleZoom = (e: React.MouseEvent, inspection: InspectionItem) => {
    e.stopPropagation();
    setSelectedIds(new Set([inspection.id]));
    onZoomToInspection(inspection);
  };

  // Handle item click - select in model
  const handleInspectionClick = (inspection: InspectionItem) => {
    setSelectedIds(new Set([inspection.id]));
    onSelectInspection(inspection);
  };

  // Handle item info button - show detail modal
  const handleShowDetail = (e: React.MouseEvent, inspection: InspectionItem) => {
    e.stopPropagation();
    setSelectedInspection(inspection);
  };

  // Render day group (used both with and without month grouping)
  const renderDayGroup = (day: DayGroup, indented: boolean = false) => (
    <div key={day.dayKey} className="inspection-date-group">
      <div className={`date-group-header ${indented ? 'date-group-header-indented' : ''}`}>
        <button
          className="date-group-toggle"
          onClick={() => toggleDay(day.dayKey)}
        >
          {expandedDays.has(day.dayKey) ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
        </button>
        <div
          className="date-group-main"
          onClick={() => handleDayClick(day)}
        >
          <span className="date-label">{day.dayLabel}</span>
          <span className="date-count">{day.items.length}</span>
        </div>
        <button
          className="date-group-zoom-btn"
          onClick={(e) => handleDayZoom(e, day)}
          title="Märgista ja zoom kõik päeva detailid"
        >
          <FiZoomIn size={16} />
        </button>
      </div>

      {expandedDays.has(day.dayKey) && (
        <div className={`date-group-items ${indented ? 'date-group-items-indented' : ''}`}>
          {day.items.map(insp => (
            <div
              key={insp.id}
              className={`inspection-item ${selectedIds.has(insp.id) ? 'inspection-item-selected' : ''}`}
              onClick={() => handleInspectionClick(insp)}
            >
              <div className="inspection-item-main">
                <span className="inspection-mark">{insp.assembly_mark || `#${insp.object_runtime_id || '?'}`}</span>
                {mode === 'all' && (
                  <span className="inspection-inspector">{insp.inspector_name}</span>
                )}
              </div>
              <div className="inspection-item-time">
                {new Date(insp.inspected_at).toLocaleTimeString('et-EE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </div>
              <button
                className="inspection-info-btn"
                onClick={(e) => handleShowDetail(e, insp)}
                title="Näita detaile"
              >
                <FiInfo size={16} />
              </button>
              <button
                className="inspection-zoom-btn"
                onClick={(e) => handleZoom(e, insp)}
                title="Zoom elemendile"
              >
                <FiZoomIn size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="inspection-list-container">
      <div className="inspection-list-header">
        <h3>
          {mode === 'mine' ? '🔴 Minu inspektsioonid' : '🟢 Kõik inspektsioonid'}
          <span className="inspection-count">
            ({inspections.length}{totalCount > inspections.length ? ` / ${totalCount}` : ''})
          </span>
        </h3>
        <button className="inspection-list-close" onClick={onClose}>
          <FiX size={18} />
        </button>
      </div>

      <div className="inspection-list-content">
        {hasMultipleMonths ? (
          // Multi-month view: Month -> Day -> Items
          monthGroups.map(month => (
            <div key={month.monthKey} className="inspection-month-group">
              <div className="month-group-header">
                <button
                  className="month-group-toggle"
                  onClick={() => toggleMonth(month.monthKey)}
                >
                  {expandedMonths.has(month.monthKey) ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                </button>
                <div
                  className="month-group-main"
                  onClick={() => handleMonthClick(month)}
                >
                  <span className="month-label">{month.monthLabel}</span>
                  <span className="month-count">{month.allItems.length}</span>
                </div>
                <button
                  className="month-group-zoom-btn"
                  onClick={(e) => handleMonthZoom(e, month)}
                  title="Märgista ja zoom kõik kuu detailid"
                >
                  <FiZoomIn size={18} />
                </button>
              </div>

              {expandedMonths.has(month.monthKey) && (
                <div className="month-group-days">
                  {month.days.map(day => renderDayGroup(day, true))}
                </div>
              )}
            </div>
          ))
        ) : (
          // Single month view: Day -> Items (no month header)
          monthGroups[0]?.days.map(day => renderDayGroup(day, false))
        )}

        {inspections.length === 0 && (
          <div className="inspection-list-empty">
            {mode === 'mine'
              ? 'Sul pole veel inspektsioone'
              : 'Inspektsioone pole veel tehtud'}
          </div>
        )}

        {/* Load more button */}
        {hasMore && (
          <div className="load-more-container">
            <button
              className="load-more-btn"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Laadin...' : `Lae juurde (${totalCount - inspections.length} veel)`}
            </button>
          </div>
        )}
      </div>

      {/* Inspection Detail Modal */}
      {selectedInspection && (
        <div className="inspection-detail-overlay" onClick={() => setSelectedInspection(null)}>
          <div className="inspection-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="inspection-detail-header">
              <h4>{selectedInspection.assembly_mark || 'Detail'}</h4>
              <button
                className="inspection-detail-close"
                onClick={() => setSelectedInspection(null)}
              >
                <FiX size={18} />
              </button>
            </div>

            <div className="inspection-detail-content">
              <div className="detail-row">
                <span className="detail-label">Inspekteerija:</span>
                <span className="detail-value">{selectedInspection.inspector_name}</span>
              </div>

              {selectedInspection.user_email && (
                <div className="detail-row">
                  <span className="detail-label">E-post:</span>
                  <span className="detail-value">{selectedInspection.user_email}</span>
                </div>
              )}

              <div className="detail-row">
                <span className="detail-label">Kuupäev:</span>
                <span className="detail-value">
                  {new Date(selectedInspection.inspected_at).toLocaleString('et-EE')}
                </span>
              </div>

              {selectedInspection.file_name && (
                <div className="detail-row">
                  <span className="detail-label">Fail:</span>
                  <span className="detail-value">{selectedInspection.file_name}</span>
                </div>
              )}

              {(selectedInspection.guid || selectedInspection.guid_ifc) && (
                <div className="detail-row">
                  <span className="detail-label">GUID:</span>
                  <span className="detail-value detail-guid">
                    {selectedInspection.guid_ifc || selectedInspection.guid}
                  </span>
                </div>
              )}

              {/* Photos section */}
              {(selectedInspection.photo_urls?.length || 0) > 0 && (
                <div className="detail-photos">
                  <span className="detail-label">Fotod:</span>
                  <div className="detail-photo-grid">
                    {selectedInspection.photo_urls?.map((url, idx) => (
                      <div
                        key={idx}
                        className="detail-photo-thumb"
                        onClick={() => openGallery(selectedInspection.photo_urls || [], idx)}
                      >
                        <img src={url} alt={`Foto ${idx + 1}`} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                className="detail-zoom-btn"
                onClick={() => {
                  onZoomToInspection(selectedInspection);
                  setSelectedInspection(null);
                }}
              >
                <FiZoomIn size={16} />
                Zoom elemendile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Gallery Modal */}
      {modalGallery && (
        <div className="photo-modal-overlay" onClick={closeGallery}>
          <div
            className="photo-modal-content"
            onClick={e => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <button className="photo-modal-close" onClick={closeGallery}>
              ✕
            </button>
            <img src={modalGallery.photos[modalGallery.currentIndex]} alt="Inspektsiooni foto" />

            {/* Navigation arrows */}
            {modalGallery.photos.length > 1 && (
              <div className="photo-modal-nav">
                <button
                  className="photo-nav-btn prev"
                  onClick={prevPhoto}
                  disabled={modalGallery.currentIndex === 0}
                >
                  <FiChevronLeft size={24} />
                </button>
                <span className="photo-counter">
                  {modalGallery.currentIndex + 1} / {modalGallery.photos.length}
                </span>
                <button
                  className="photo-nav-btn next"
                  onClick={nextPhoto}
                  disabled={modalGallery.currentIndex === modalGallery.photos.length - 1}
                >
                  <FiChevronRight size={24} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
