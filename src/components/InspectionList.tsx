import { useState, useCallback, useEffect, useRef } from 'react';
import { FiChevronDown, FiChevronRight, FiZoomIn, FiX, FiInfo, FiChevronLeft, FiEdit2, FiSave, FiTrash2 } from 'react-icons/fi';
import { supabase, InspectionResult, InspectionCheckpoint } from '../supabase';

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
  product_name?: string;
}

// Extended result with checkpoint name
interface ResultWithCheckpoint extends InspectionResult {
  checkpoint_name?: string;
  checkpoint_code?: string;
  result_photos?: { id: string; url: string; thumbnail_url?: string }[];
}

interface InspectionListProps {
  inspections: InspectionItem[];
  mode: 'mine' | 'all' | 'todo';
  totalCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  projectId: string;
  onZoomToInspection: (inspection: InspectionItem) => void;
  onSelectInspection: (inspection: InspectionItem) => void;
  onSelectGroup: (inspections: InspectionItem[]) => void;
  onZoomToGroup: (inspections: InspectionItem[]) => void;
  onLoadMore: () => void;
  onClose: () => void;
  onRefresh?: () => void;
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

// Group inspections by product_name (for todo mode)
interface ProductGroup {
  productKey: string;
  productLabel: string;
  items: InspectionItem[];
}

function groupByProduct(inspections: InspectionItem[]): ProductGroup[] {
  const productMap: Record<string, ProductGroup> = {};

  for (const insp of inspections) {
    const productKey = insp.product_name || '_unknown';
    const productLabel = insp.product_name || 'Tundmatu';

    if (!productMap[productKey]) {
      productMap[productKey] = {
        productKey,
        productLabel,
        items: []
      };
    }

    productMap[productKey].items.push(insp);
  }

  // Sort by product name alphabetically, unknown last
  const sortedProducts = Object.values(productMap).sort((a, b) => {
    if (a.productKey === '_unknown') return 1;
    if (b.productKey === '_unknown') return -1;
    return a.productLabel.localeCompare(b.productLabel, 'et-EE');
  });

  return sortedProducts;
}

export default function InspectionList({
  inspections,
  mode,
  totalCount,
  hasMore,
  loadingMore,
  projectId,
  onZoomToInspection,
  onSelectInspection,
  onSelectGroup,
  onZoomToGroup,
  onLoadMore,
  onClose,
  onRefresh
}: InspectionListProps) {
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [selectedInspection, setSelectedInspection] = useState<InspectionItem | null>(null);
  const [modalGallery, setModalGallery] = useState<{ photos: string[], currentIndex: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // Checkpoint results state
  const [checkpointResults, setCheckpointResults] = useState<ResultWithCheckpoint[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedResults, setEditedResults] = useState<Record<string, { response_value: string; comment: string }>>({});
  const [savingResults, setSavingResults] = useState(false);
  const [checkpoints, setCheckpoints] = useState<InspectionCheckpoint[]>([]);

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

  // Fetch checkpoint results for an assembly
  const fetchCheckpointResults = useCallback(async (assemblyGuid: string) => {
    setLoadingResults(true);
    setCheckpointResults([]);
    setCheckpoints([]);

    try {
      // Fetch results for this assembly
      const { data: results, error: resultsError } = await supabase
        .from('inspection_results')
        .select('*')
        .eq('project_id', projectId)
        .eq('assembly_guid', assemblyGuid)
        .order('created_at', { ascending: true });

      if (resultsError) {
        console.error('Error fetching results:', resultsError);
        return;
      }

      if (!results || results.length === 0) {
        setCheckpointResults([]);
        return;
      }

      // Fetch checkpoint details for these results
      const checkpointIds = [...new Set(results.map(r => r.checkpoint_id))];
      const { data: checkpointsData, error: checkpointsError } = await supabase
        .from('inspection_checkpoints')
        .select('*')
        .in('id', checkpointIds);

      if (checkpointsError) {
        console.error('Error fetching checkpoints:', checkpointsError);
      }

      // Create a map of checkpoint details
      const checkpointMap: Record<string, InspectionCheckpoint> = {};
      if (checkpointsData) {
        for (const cp of checkpointsData) {
          checkpointMap[cp.id] = cp;
        }
        setCheckpoints(checkpointsData);
      }

      // Fetch photos for these results
      const resultIds = results.map(r => r.id);
      const { data: photosData } = await supabase
        .from('inspection_result_photos')
        .select('id, result_id, url, thumbnail_url')
        .in('result_id', resultIds)
        .order('sort_order', { ascending: true });

      // Create a map of photos by result_id
      const photosMap: Record<string, { id: string; url: string; thumbnail_url?: string }[]> = {};
      if (photosData) {
        for (const photo of photosData) {
          if (!photosMap[photo.result_id]) {
            photosMap[photo.result_id] = [];
          }
          photosMap[photo.result_id].push({
            id: photo.id,
            url: photo.url,
            thumbnail_url: photo.thumbnail_url
          });
        }
      }

      // Merge checkpoint info and photos with results
      const resultsWithCheckpoints: ResultWithCheckpoint[] = results.map(r => ({
        ...r,
        checkpoint_name: checkpointMap[r.checkpoint_id]?.name,
        checkpoint_code: checkpointMap[r.checkpoint_id]?.code,
        result_photos: photosMap[r.id] || []
      }));

      setCheckpointResults(resultsWithCheckpoints);
    } catch (e) {
      console.error('Error fetching checkpoint results:', e);
    } finally {
      setLoadingResults(false);
    }
  }, [projectId]);

  // Start edit mode
  const startEditMode = () => {
    // Initialize edited values from current results
    const initial: Record<string, { response_value: string; comment: string }> = {};
    for (const result of checkpointResults) {
      initial[result.id] = {
        response_value: result.response_value,
        comment: result.comment || ''
      };
    }
    setEditedResults(initial);
    setEditMode(true);
  };

  // Cancel edit mode
  const cancelEditMode = () => {
    setEditMode(false);
    setEditedResults({});
  };

  // Save edited results
  const saveEditedResults = async () => {
    setSavingResults(true);
    try {
      const updates = Object.entries(editedResults).map(([id, values]) => ({
        id,
        response_value: values.response_value,
        comment: values.comment || null,
        updated_at: new Date().toISOString()
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('inspection_results')
          .update({
            response_value: update.response_value,
            comment: update.comment,
            updated_at: update.updated_at
          })
          .eq('id', update.id);

        if (error) {
          console.error('Error updating result:', error);
          throw error;
        }
      }

      // Refresh the results
      if (selectedInspection?.guid) {
        await fetchCheckpointResults(selectedInspection.guid);
      }
      setEditMode(false);
      setEditedResults({});
      onRefresh?.();
    } catch (e) {
      console.error('Error saving results:', e);
    } finally {
      setSavingResults(false);
    }
  };

  // Delete a single result
  const deleteResult = async (resultId: string) => {
    if (!confirm('Kas oled kindel, et soovid selle tulemuse kustutada?')) {
      return;
    }

    try {
      // First delete any photos
      await supabase
        .from('inspection_result_photos')
        .delete()
        .eq('result_id', resultId);

      // Then delete the result
      const { error } = await supabase
        .from('inspection_results')
        .delete()
        .eq('id', resultId);

      if (error) throw error;

      // Refresh results
      if (selectedInspection?.guid) {
        await fetchCheckpointResults(selectedInspection.guid);
      }
      onRefresh?.();
    } catch (e) {
      console.error('Error deleting result:', e);
    }
  };

  // Get response option color
  const getResponseColor = (checkpoint: InspectionCheckpoint | undefined, value: string): string => {
    if (!checkpoint) return 'var(--modus-gray-500)';
    const option = checkpoint.response_options?.find(o => o.value === value);
    if (!option) return 'var(--modus-gray-500)';

    const colorMap: Record<string, string> = {
      green: 'var(--modus-success)',
      yellow: 'var(--modus-warning)',
      red: 'var(--modus-danger)',
      blue: 'var(--modus-info)',
      gray: 'var(--modus-gray-500)',
      orange: '#f97316'
    };
    return colorMap[option.color] || 'var(--modus-gray-500)';
  };

  const monthGroups = groupByMonthAndDay(inspections);
  const hasMultipleMonths = monthGroups.length > 1;
  const productGroups = groupByProduct(inspections);

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

  const toggleProduct = (productKey: string) => {
    const newExpanded = new Set(expandedProducts);
    if (newExpanded.has(productKey)) {
      newExpanded.delete(productKey);
    } else {
      newExpanded.add(productKey);
    }
    setExpandedProducts(newExpanded);
  };

  // Handle product click - select all items in product group
  const handleProductClick = (product: ProductGroup) => {
    setSelectedIds(new Set(product.items.map(item => item.id)));
    onSelectGroup(product.items);
    // Expand the product
    if (!expandedProducts.has(product.productKey)) {
      toggleProduct(product.productKey);
    }
  };

  // Handle product zoom
  const handleProductZoom = (e: React.MouseEvent, product: ProductGroup) => {
    e.stopPropagation();
    setSelectedIds(new Set(product.items.map(item => item.id)));
    onZoomToGroup(product.items);
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
    setEditMode(false);
    setEditedResults({});

    // Fetch checkpoint results if we have a GUID
    if (inspection.guid || inspection.guid_ifc) {
      fetchCheckpointResults(inspection.guid || inspection.guid_ifc || '');
    }
  };

  // Close detail modal and reset state
  const closeDetailModal = () => {
    setSelectedInspection(null);
    setCheckpointResults([]);
    setCheckpoints([]);
    setEditMode(false);
    setEditedResults({});
  };

  // Render product group (for todo mode)
  const renderProductGroup = (product: ProductGroup) => (
    <div key={product.productKey} className="inspection-date-group">
      <div className="date-group-header">
        <button
          className="date-group-toggle"
          onClick={() => toggleProduct(product.productKey)}
        >
          {expandedProducts.has(product.productKey) ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
        </button>
        <div
          className="date-group-main"
          onClick={() => handleProductClick(product)}
        >
          <span className="date-label">{product.productLabel}</span>
          <span className="date-count">{product.items.length}</span>
        </div>
        <button
          className="date-group-zoom-btn"
          onClick={(e) => handleProductZoom(e, product)}
          title="Märgista ja zoom kõik toote detailid"
        >
          <FiZoomIn size={16} />
        </button>
      </div>

      {expandedProducts.has(product.productKey) && (
        <div className="date-group-items">
          {product.items.map(insp => (
            <div
              key={insp.id}
              className={`inspection-item ${selectedIds.has(insp.id) ? 'inspection-item-selected' : ''}`}
              onClick={() => handleInspectionClick(insp)}
            >
              <div className="inspection-item-main">
                <span className="inspection-mark">
                  {insp.assembly_mark || `#${insp.object_runtime_id || '?'}`}
                </span>
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
                <span className="inspection-mark">
                  {insp.assembly_mark || `#${insp.object_runtime_id || '?'}`}
                  {insp.product_name && <span className="inspection-product"> | {insp.product_name}</span>}
                </span>
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
          {mode === 'mine' ? '🔴 Minu inspektsioonid' : mode === 'todo' ? '🟡 Tegemata' : '🟢 Kõik inspektsioonid'}
          <span className="inspection-count">
            ({inspections.length}{totalCount > inspections.length ? ` / ${totalCount}` : ''})
          </span>
        </h3>
        <button className="inspection-list-close" onClick={onClose}>
          <FiX size={18} />
        </button>
      </div>

      <div className="inspection-list-content">
        {mode === 'todo' ? (
          // Todo mode: Group by product_name
          productGroups.map(product => renderProductGroup(product))
        ) : hasMultipleMonths ? (
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
              : mode === 'todo'
              ? 'Tegemata üksusi pole'
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
        <div className="inspection-detail-overlay" onClick={closeDetailModal}>
          <div className="inspection-detail-modal inspection-detail-modal-large" onClick={e => e.stopPropagation()}>
            <div className="inspection-detail-header">
              <h4>{selectedInspection.assembly_mark || 'Detail'}</h4>
              <div className="inspection-detail-header-actions">
                {checkpointResults.length > 0 && !editMode && (
                  <button
                    className="inspection-edit-btn"
                    onClick={startEditMode}
                    title="Muuda"
                  >
                    <FiEdit2 size={16} />
                  </button>
                )}
                <button
                  className="inspection-detail-close"
                  onClick={closeDetailModal}
                >
                  <FiX size={18} />
                </button>
              </div>
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

              {/* Checkpoint Results Section */}
              {loadingResults && (
                <div className="checkpoint-results-loading">
                  Laadin kontrollpunkte...
                </div>
              )}

              {!loadingResults && checkpointResults.length > 0 && (
                <div className="checkpoint-results-section">
                  <div className="checkpoint-results-header">
                    <span className="checkpoint-results-title">Kontrollpunktid ({checkpointResults.length})</span>
                    {editMode && (
                      <div className="checkpoint-edit-actions">
                        <button
                          className="checkpoint-save-btn"
                          onClick={saveEditedResults}
                          disabled={savingResults}
                        >
                          <FiSave size={14} />
                          {savingResults ? 'Salvestan...' : 'Salvesta'}
                        </button>
                        <button
                          className="checkpoint-cancel-btn"
                          onClick={cancelEditMode}
                          disabled={savingResults}
                        >
                          Tühista
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="checkpoint-results-list">
                    {checkpointResults.map((result) => {
                      const checkpoint = checkpoints.find(cp => cp.id === result.checkpoint_id);
                      const responseColor = getResponseColor(checkpoint, result.response_value);

                      return (
                        <div key={result.id} className="checkpoint-result-item">
                          <div className="checkpoint-result-header">
                            <span className="checkpoint-result-name">
                              {result.checkpoint_name || result.checkpoint_code || 'Kontrollpunkt'}
                            </span>
                            {editMode && (
                              <button
                                className="checkpoint-delete-btn"
                                onClick={() => deleteResult(result.id)}
                                title="Kustuta"
                              >
                                <FiTrash2 size={14} />
                              </button>
                            )}
                          </div>

                          {editMode ? (
                            <div className="checkpoint-result-edit">
                              <div className="checkpoint-edit-field">
                                <label>Staatus:</label>
                                <select
                                  value={editedResults[result.id]?.response_value || result.response_value}
                                  onChange={(e) => setEditedResults(prev => ({
                                    ...prev,
                                    [result.id]: {
                                      ...prev[result.id],
                                      response_value: e.target.value
                                    }
                                  }))}
                                >
                                  {checkpoint?.response_options?.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="checkpoint-edit-field">
                                <label>Kommentaar:</label>
                                <textarea
                                  value={editedResults[result.id]?.comment || ''}
                                  onChange={(e) => setEditedResults(prev => ({
                                    ...prev,
                                    [result.id]: {
                                      ...prev[result.id],
                                      comment: e.target.value
                                    }
                                  }))}
                                  rows={2}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="checkpoint-result-view">
                              <div
                                className="checkpoint-result-status"
                                style={{ backgroundColor: responseColor }}
                              >
                                {result.response_label || result.response_value}
                              </div>
                              {result.comment && (
                                <div className="checkpoint-result-comment">
                                  {result.comment}
                                </div>
                              )}
                              {/* Photos for this checkpoint result */}
                              {result.result_photos && result.result_photos.length > 0 && (
                                <div className="checkpoint-result-photos">
                                  {result.result_photos.map((photo, idx) => (
                                    <div
                                      key={photo.id}
                                      className="checkpoint-photo-thumb"
                                      onClick={() => openGallery(
                                        result.result_photos!.map(p => p.url),
                                        idx
                                      )}
                                    >
                                      <img
                                        src={photo.thumbnail_url || photo.url}
                                        alt={`Foto ${idx + 1}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="checkpoint-result-meta">
                                {new Date(result.created_at).toLocaleString('et-EE')}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!loadingResults && checkpointResults.length === 0 && (selectedInspection.guid || selectedInspection.guid_ifc) && (
                <div className="checkpoint-results-empty">
                  Kontrollpunktide tulemusi ei leitud
                </div>
              )}

              <button
                className="detail-zoom-btn"
                onClick={() => {
                  onZoomToInspection(selectedInspection);
                  closeDetailModal();
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
