import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, InspectionResultPhotoExtended } from '../supabase';

export interface InspectionGalleryProps {
  projectId: string;
  onClose: () => void;
  canDelete?: boolean;
  onDeletePhoto?: (photoId: string) => void;
}

interface GalleryPhoto extends InspectionResultPhotoExtended {
  assembly_mark?: string;
  inspector_name?: string;
  category_name?: string;
}

/**
 * Inspection photos gallery component
 * Shows all photos for admin/moderator with filtering
 */
export const InspectionGallery: React.FC<InspectionGalleryProps> = ({
  projectId,
  onClose,
  canDelete = false,
  onDeletePhoto
}) => {
  const { t } = useTranslation('common');
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Load photos
  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('v_inspection_photos_gallery')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (queryError) throw queryError;

      setPhotos(data || []);
    } catch (err) {
      console.error('Error loading gallery:', err);
      setError(err instanceof Error ? err.message : t('gallery.loadError'));
    } finally {
      setLoading(false);
    }
  }, [projectId, page]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // Filter photos
  const filteredPhotos = photos.filter((photo) => {
    // Type filter
    if (filterType !== 'all' && photo.photo_type !== filterType) return false;

    // Date filter
    if (filterDateFrom) {
      const photoDate = new Date(photo.created_at).toISOString().split('T')[0];
      if (photoDate < filterDateFrom) return false;
    }
    if (filterDateTo) {
      const photoDate = new Date(photo.created_at).toISOString().split('T')[0];
      if (photoDate > filterDateTo) return false;
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchesAssembly = photo.assembly_mark?.toLowerCase().includes(term);
      const matchesInspector = photo.inspector_name?.toLowerCase().includes(term);
      const matchesUploader = photo.uploaded_by_name?.toLowerCase().includes(term);
      const matchesCategory = photo.category_name?.toLowerCase().includes(term);

      if (!matchesAssembly && !matchesInspector && !matchesUploader && !matchesCategory) {
        return false;
      }
    }

    return true;
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDelete = async (photoId: string) => {
    if (!confirm(t('gallery.deleteConfirm'))) return;

    try {
      const { error: deleteError } = await supabase
        .from('inspection_result_photos')
        .delete()
        .eq('id', photoId);

      if (deleteError) throw deleteError;

      onDeletePhoto?.(photoId);
      loadPhotos();
      setSelectedPhoto(null);
    } catch (err) {
      console.error('Error deleting photo:', err);
      alert(t('gallery.deleteError'));
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.9)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #374151',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#1F2937'
        }}
      >
        <h2 style={{ margin: 0, color: 'white', fontSize: '18px' }}>
          {t('gallery.title')} ({filteredPhotos.length})
        </h2>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            backgroundColor: 'transparent',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          ×
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: '#374151',
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}
      >
        {/* Search */}
        <input
          type="text"
          placeholder={t('gallery.search')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '14px',
            minWidth: '150px'
          }}
        />

        {/* Type filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '14px'
          }}
        >
          <option value="all">{t('gallery.allTypes')}</option>
          <option value="user">{t('gallery.userPhotos')}</option>
          <option value="snapshot_3d">{t('gallery.view3d')}</option>
          <option value="topview">{t('gallery.topviews')}</option>
          <option value="arrival">{t('gallery.arrivalPhotos')}</option>
          <option value="damage">{t('gallery.damages')}</option>
        </select>

        {/* Date filters */}
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '14px'
          }}
        />
        <span style={{ color: 'white' }}>-</span>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '14px'
          }}
        />

        {/* Clear filters */}
        <button
          onClick={() => {
            setSearchTerm('');
            setFilterType('all');
            setFilterDateFrom('');
            setFilterDateTo('');
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#6B7280',
            color: 'white',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {t('gallery.clearFilters')}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'white' }}>
            {t('gallery.loading')}
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#EF4444' }}>
            {error}
          </div>
        )}

        {!loading && !error && filteredPhotos.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>
            {t('gallery.noPhotos')}
          </div>
        )}

        {!loading && !error && filteredPhotos.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '12px'
            }}
          >
            {filteredPhotos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                style={{
                  backgroundColor: '#374151',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'transform 0.2s'
                }}
              >
                <div
                  style={{
                    aspectRatio: '1',
                    overflow: 'hidden',
                    backgroundColor: '#1F2937'
                  }}
                >
                  <img
                    src={photo.thumbnail_url || photo.url}
                    alt={photo.assembly_mark || t('gallery.image')}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    loading="lazy"
                  />
                </div>
                <div style={{ padding: '8px' }}>
                  <div style={{ color: 'white', fontSize: '13px', fontWeight: 500 }}>
                    {photo.assembly_mark || '-'}
                  </div>
                  <div style={{ color: '#9CA3AF', fontSize: '11px' }}>
                    {photo.uploaded_by_name || photo.inspector_name || '-'}
                  </div>
                  <div style={{ color: '#6B7280', fontSize: '10px' }}>
                    {formatDate(photo.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && photos.length === pageSize && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={() => setPage(page + 1)}
              style={{
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#3B82F6',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              {t('gallery.loadMore')}
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selectedPhoto && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.95)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1100
          }}
          onClick={() => setSelectedPhoto(null)}
        >
          {/* Lightbox header */}
          <div
            style={{
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ color: 'white' }}>
              <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                {selectedPhoto.assembly_mark || t('gallery.image')}
              </div>
              <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                {selectedPhoto.category_name && `${selectedPhoto.category_name} • `}
                {selectedPhoto.uploaded_by_name || selectedPhoto.inspector_name} •{' '}
                {formatDate(selectedPhoto.created_at)}
              </div>
              <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
                {selectedPhoto.original_filename} • {formatFileSize(selectedPhoto.compressed_size || selectedPhoto.file_size)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {canDelete && (
                <button
                  onClick={() => handleDelete(selectedPhoto.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {t('gallery.delete')}
                </button>
              )}
              <button
                onClick={() => setSelectedPhoto(null)}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'white',
                  fontSize: '28px',
                  cursor: 'pointer',
                  padding: '0 8px'
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Image */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
          >
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.assembly_mark || t('gallery.image')}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default InspectionGallery;
