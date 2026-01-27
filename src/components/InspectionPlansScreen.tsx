import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrimbleExUser, supabase, INSPECTION_STATUS_COLORS } from '../supabase';
import {
  FiSearch, FiTool, FiBox, FiDroplet, FiZap, FiLayers,
  FiGrid, FiSquare, FiMoreHorizontal, FiLoader, FiChevronRight, FiClipboard, FiAlertTriangle, FiShield
} from 'react-icons/fi';
import { IconType } from 'react-icons';
import PageHeader from './PageHeader';
import { isAdmin as checkIsAdmin, isAdminOrModerator as checkIsAdminOrModerator } from '../constants/roles';

interface InspectionPlansScreenProps {
  user: TrimbleExUser;
  projectId: string;
  onBack: () => void;
  onSelectInspectionType: (typeId: string, typeCode: string, typeName: string) => void;
  onNavigate?: (mode: 'inspection_admin') => void; // Navigation to admin panel
  matchedTypeIds?: string[]; // Inspection types that match currently selected detail
  completedTypeIds?: string[]; // Inspection types where selected detail is already inspected
}

// Database inspection type
interface InspectionType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  sort_order: number;
  is_active: boolean;
}

// Plan statistics per type
interface TypeStats {
  typeId: string;
  totalItems: number;
  completedItems: number;
  // Detailed status counts
  plannedCount: number;      // Not yet inspected
  inProgressCount: number;   // Started but not completed
  pendingReviewCount: number; // Completed, awaiting review
  rejectedCount: number;     // Rejected by reviewer
  approvedCount: number;     // Approved by reviewer
}

// Map database icon names to React icons
const iconMap: Record<string, IconType> = {
  'wrench': FiTool,
  'cube': FiBox,
  'tool': FiTool,
  'paint-brush': FiDroplet,
  'fire': FiZap,
  'box': FiBox,
  'layers': FiLayers,
  'layout': FiGrid,
  'square': FiSquare,
  'more-horizontal': FiMoreHorizontal,
  'search': FiSearch,
  'alert-triangle': FiAlertTriangle,
};

export default function InspectionPlansScreen({
  user,
  projectId,
  onBack,
  onSelectInspectionType,
  onNavigate,
  matchedTypeIds = [],
  completedTypeIds = []
}: InspectionPlansScreenProps) {
  const { t } = useTranslation('inspection');
  const [loading, setLoading] = useState(true);
  const [inspectionTypes, setInspectionTypes] = useState<InspectionType[]>([]);
  const [typeStats, setTypeStats] = useState<Record<string, TypeStats>>({});

  // Load inspection types that have plan items for this project
  useEffect(() => {
    async function loadInspectionTypes() {
      setLoading(true);
      try {
        // Get inspection types that have plan items in this project (including review_status)
        const { data: planItems, error: planError } = await supabase
          .from('inspection_plan_items')
          .select(`
            id,
            inspection_type_id,
            guid,
            guid_ifc,
            review_status,
            inspection_types!inspection_plan_items_inspection_type_id_fkey (
              id, code, name, description, icon, color, sort_order, is_active
            )
          `)
          .eq('project_id', projectId);

        if (planError) {
          console.error('Error loading plan items:', planError);
          setLoading(false);
          return;
        }

        // Get inspection results to know which plan items have been inspected
        // We only need plan_item_id to check existence - review_status is on inspection_plan_items
        const { data: results, error: resultsError } = await supabase
          .from('inspection_results')
          .select('plan_item_id')
          .eq('project_id', projectId);

        // Create set of plan item IDs that have inspection results
        const inspectedPlanItemIds = new Set<string>();
        if (!resultsError && results) {
          for (const r of results) {
            if (r.plan_item_id) {
              inspectedPlanItemIds.add(r.plan_item_id);
            }
          }
        }

        // Group by inspection type and calculate stats
        const typeMap = new Map<string, InspectionType>();
        const statsMap: Record<string, TypeStats> = {};

        for (const item of planItems || []) {
          const typeData = item.inspection_types as unknown as InspectionType;
          if (!typeData || !typeData.is_active) continue;

          // Skip "OTHER" / "Muu" type
          if (typeData.code === 'OTHER') continue;

          if (!typeMap.has(typeData.id)) {
            typeMap.set(typeData.id, typeData);
            statsMap[typeData.id] = {
              typeId: typeData.id,
              totalItems: 0,
              completedItems: 0,
              plannedCount: 0,
              inProgressCount: 0,
              pendingReviewCount: 0,
              rejectedCount: 0,
              approvedCount: 0
            };
          }

          statsMap[typeData.id].totalItems++;

          // Check if this plan item has been inspected (has results)
          const hasResults = inspectedPlanItemIds.has(item.id);
          // Get review_status from plan item
          const reviewStatus = item.review_status;

          if (!hasResults) {
            // No results - planned
            statsMap[typeData.id].plannedCount++;
          } else if (reviewStatus === 'approved') {
            statsMap[typeData.id].approvedCount++;
            statsMap[typeData.id].completedItems++;
          } else if (reviewStatus === 'rejected') {
            statsMap[typeData.id].rejectedCount++;
          } else {
            // Has results but pending review
            statsMap[typeData.id].pendingReviewCount++;
            statsMap[typeData.id].completedItems++;
          }
        }

        // Sort by sort_order
        const sortedTypes = Array.from(typeMap.values()).sort((a, b) => a.sort_order - b.sort_order);

        setInspectionTypes(sortedTypes);
        setTypeStats(statsMap);
      } catch (e) {
        console.error('Error loading inspection types:', e);
      } finally {
        setLoading(false);
      }
    }

    if (projectId) {
      loadInspectionTypes();
    }
  }, [projectId]);

  const getIcon = (iconName: string): IconType => {
    return iconMap[iconName] || FiSearch;
  };

  const handleTypeClick = (type: InspectionType) => {
    onSelectInspectionType(type.id, type.code, type.name);
  };

  return (
    <div className="screen">
      <PageHeader
        title={t('plans.title')}
        onBack={onBack}
        user={user}
        projectId={projectId}
        onSelectInspectionType={onSelectInspectionType}
      />

      {/* Admin/Moderator button for inspection admin panel */}
      {checkIsAdminOrModerator(user) && onNavigate && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>
          <button
            onClick={() => onNavigate('inspection_admin')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              width: '100%',
              justifyContent: 'center'
            }}
          >
            <FiShield size={18} />
            {t('plans.adminPanel')}
          </button>
        </div>
      )}

      <div className="screen-content">
        {loading ? (
          <div className="empty-state">
            <FiLoader className="spinner" size={48} />
            <p>{t('plans.loading')}</p>
          </div>
        ) : inspectionTypes.length === 0 ? (
          <div className="empty-state">
            <FiClipboard size={48} style={{ color: '#6b7280' }} />
            <p>{t('plans.noPlans')}</p>
            {checkIsAdmin(user) && (
              <p style={{ marginTop: '8px', fontSize: '14px', color: '#6b7280' }}>
                {t('plans.createHint')}
              </p>
            )}
          </div>
        ) : (
          <div className="inspection-plans-list">
            {inspectionTypes.map((type) => {
              const IconComponent = getIcon(type.icon);
              const stats = typeStats[type.id];
              const isMatched = matchedTypeIds.includes(type.id);
              const isCompleted = completedTypeIds.includes(type.id);
              const matchClass = isMatched ? (isCompleted ? 'matched-completed' : 'matched-pending') : '';

              return (
                <button
                  key={type.id}
                  className={`inspection-plan-card ${matchClass}`}
                  onClick={() => handleTypeClick(type)}
                >
                  <div className="inspection-plan-header">
                    <span className="inspection-plan-icon" style={{ color: type.color || 'var(--modus-primary)' }}>
                      <IconComponent size={24} />
                    </span>
                    <div className="inspection-plan-info">
                      <h3 className="inspection-plan-title">{type.name}</h3>
                      {type.description && (
                        <p className="inspection-plan-description">{type.description}</p>
                      )}
                    </div>
                    <span className="inspection-plan-arrow">
                      <FiChevronRight size={20} />
                    </span>
                  </div>

                  {stats && (
                    <div className="inspection-plan-stats">
                      {/* Status indicators with colors */}
                      <div className="inspection-plan-status-row">
                        <span
                          className="status-indicator"
                          style={{ backgroundColor: INSPECTION_STATUS_COLORS.planned.hex }}
                          title={INSPECTION_STATUS_COLORS.planned.label}
                        >
                          {stats.plannedCount}
                        </span>
                        <span
                          className="status-indicator"
                          style={{ backgroundColor: INSPECTION_STATUS_COLORS.inProgress.hex }}
                          title={INSPECTION_STATUS_COLORS.inProgress.label}
                        >
                          {stats.inProgressCount}
                        </span>
                        <span
                          className="status-indicator"
                          style={{ backgroundColor: INSPECTION_STATUS_COLORS.completed.hex }}
                          title={INSPECTION_STATUS_COLORS.completed.label}
                        >
                          {stats.pendingReviewCount}
                        </span>
                        <span
                          className="status-indicator"
                          style={{ backgroundColor: INSPECTION_STATUS_COLORS.rejected.hex }}
                          title={INSPECTION_STATUS_COLORS.rejected.label}
                        >
                          {stats.rejectedCount}
                        </span>
                        <span
                          className="status-indicator"
                          style={{ backgroundColor: INSPECTION_STATUS_COLORS.approved.hex }}
                          title={INSPECTION_STATUS_COLORS.approved.label}
                        >
                          {stats.approvedCount}
                        </span>
                      </div>
                      {stats.totalItems > 0 && (
                        <div className="inspection-plan-progress">
                          <div
                            className="inspection-plan-progress-bar"
                            style={{
                              width: `${(stats.completedItems / stats.totalItems) * 100}%`,
                              backgroundColor: type.color || 'var(--modus-primary)'
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
