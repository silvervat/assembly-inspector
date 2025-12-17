import { useState } from 'react';
import { FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiInfo } from 'react-icons/fi';

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

// Group inspections by date
function groupByDate(inspections: InspectionItem[]): Record<string, InspectionItem[]> {
  const groups: Record<string, InspectionItem[]> = {};

  for (const insp of inspections) {
    const date = new Date(insp.inspected_at).toLocaleDateString('et-EE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(insp);
  }

  return groups;
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
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [selectedInspection, setSelectedInspection] = useState<InspectionItem | null>(null);
  const [modalPhoto, setModalPhoto] = useState<string | null>(null);

  const groupedInspections = groupByDate(inspections);
  const sortedDates = Object.keys(groupedInspections).sort((a, b) => {
    return new Date(groupedInspections[b][0].inspected_at).getTime() -
           new Date(groupedInspections[a][0].inspected_at).getTime();
  });

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  // Handle group header click - select all items in group
  const handleGroupClick = (date: string) => {
    const groupItems = groupedInspections[date];
    onSelectGroup(groupItems);
    // Also expand the group
    if (!expandedDates.has(date)) {
      toggleDate(date);
    }
  };

  // Handle group zoom button - zoom to all items in group
  const handleGroupZoom = (e: React.MouseEvent, date: string) => {
    e.stopPropagation();
    const groupItems = groupedInspections[date];
    onZoomToGroup(groupItems);
  };

  // Handle single inspection zoom
  const handleZoom = (e: React.MouseEvent, inspection: InspectionItem) => {
    e.stopPropagation();
    onZoomToInspection(inspection);
  };

  // Handle item click - select in model
  const handleInspectionClick = (inspection: InspectionItem) => {
    onSelectInspection(inspection);
  };

  // Handle item double-click or info button - show detail modal
  const handleShowDetail = (e: React.MouseEvent, inspection: InspectionItem) => {
    e.stopPropagation();
    setSelectedInspection(inspection);
  };

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
        {sortedDates.map(date => (
          <div key={date} className="inspection-date-group">
            <div className="date-group-header">
              <button
                className="date-group-toggle"
                onClick={() => toggleDate(date)}
              >
                {expandedDates.has(date) ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
              </button>
              <div
                className="date-group-main"
                onClick={() => handleGroupClick(date)}
              >
                <span className="date-label">{date}</span>
                <span className="date-count">{groupedInspections[date].length}</span>
              </div>
              <button
                className="date-group-zoom-btn"
                onClick={(e) => handleGroupZoom(e, date)}
                title="Märgista ja zoom kõik grupi detailid"
              >
                <FiZoomIn size={16} />
              </button>
            </div>

            {expandedDates.has(date) && (
              <div className="date-group-items">
                {groupedInspections[date].map(insp => (
                  <div
                    key={insp.id}
                    className="inspection-item"
                    onClick={() => handleInspectionClick(insp)}
                  >
                    <div className="inspection-item-main">
                      <span className="inspection-mark">{insp.assembly_mark || 'N/A'}</span>
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
        ))}

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
                        onClick={() => setModalPhoto(url)}
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

      {/* Photo Modal */}
      {modalPhoto && (
        <div className="photo-modal-overlay" onClick={() => setModalPhoto(null)}>
          <div className="photo-modal-content" onClick={e => e.stopPropagation()}>
            <button className="photo-modal-close" onClick={() => setModalPhoto(null)}>
              ✕
            </button>
            <img src={modalPhoto} alt="Inspektsiooni foto" />
          </div>
        </div>
      )}
    </div>
  );
}
