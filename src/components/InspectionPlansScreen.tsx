import { useEffect, useState } from 'react';
import { TrimbleExUser, supabase } from '../supabase';
import {
  FiSearch, FiTool, FiBox, FiDroplet, FiZap, FiLayers,
  FiGrid, FiSquare, FiMoreHorizontal, FiLoader, FiChevronRight, FiClipboard, FiAlertTriangle, FiShield
} from 'react-icons/fi';
import { IconType } from 'react-icons';
import PageHeader from './PageHeader';

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
  const [loading, setLoading] = useState(true);
  const [inspectionTypes, setInspectionTypes] = useState<InspectionType[]>([]);
  const [typeStats, setTypeStats] = useState<Record<string, TypeStats>>({});

  // Load inspection types that have plan items for this project
  useEffect(() => {
    async function loadInspectionTypes() {
      setLoading(true);
      try {
        // Get inspection types that have plan items in this project
        const { data: planItems, error: planError } = await supabase
          .from('inspection_plan_items')
          .select(`
            id,
            inspection_type_id,
            guid,
            guid_ifc,
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

        // Get all completed inspection results for this project
        const { data: results, error: resultsError } = await supabase
          .from('inspection_results')
          .select('plan_item_id, assembly_guid')
          .eq('project_id', projectId);

        // Create a set of completed plan_item_ids and assembly_guids
        const completedPlanItemIds = new Set<string>();
        const completedGuids = new Set<string>();
        if (!resultsError && results) {
          for (const r of results) {
            if (r.plan_item_id) completedPlanItemIds.add(r.plan_item_id);
            if (r.assembly_guid) completedGuids.add(r.assembly_guid);
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
              completedItems: 0
            };
          }

          statsMap[typeData.id].totalItems++;

          // Check if this plan item is completed (has results by plan_item_id or matching GUID)
          const isCompleted = completedPlanItemIds.has(item.id) ||
            (item.guid && completedGuids.has(item.guid)) ||
            (item.guid_ifc && completedGuids.has(item.guid_ifc));

          if (isCompleted) {
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
        title="Kontrollplaanid"
        onBack={onBack}
        user={user}
        projectId={projectId}
        onSelectInspectionType={onSelectInspectionType}
      />

      {/* Admin/Moderator button for inspection admin panel */}
      {(user.role === 'admin' || user.role === 'moderator') && onNavigate && (
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
            Admin paneel
          </button>
        </div>
      )}

      <div className="screen-content">
        {loading ? (
          <div className="empty-state">
            <FiLoader className="spinner" size={48} />
            <p>Laadin kontrollplaane...</p>
          </div>
        ) : inspectionTypes.length === 0 ? (
          <div className="empty-state">
            <FiClipboard size={48} style={{ color: '#6b7280' }} />
            <p>Selles projektis pole veel ühtegi kontrollplaani</p>
            {user.role === 'admin' && (
              <p style={{ marginTop: '8px', fontSize: '14px', color: '#6b7280' }}>
                Koosta inspektsiooni kava administratsiooni menüüst
              </p>
            )}
          </div>
        ) : (
          <div className="inspection-plans-list">
            {inspectionTypes.map((type) => {
              const IconComponent = getIcon(type.icon);
              const stats = typeStats[type.id];
              const pendingCount = stats ? stats.totalItems - stats.completedItems : 0;
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
                      <div className="inspection-plan-counts">
                        <span className="stat-item">
                          <span className="stat-label">Kokku:</span>
                          <span className="stat-value">{stats.totalItems}</span>
                        </span>
                        <span className="stat-item">
                          <span className="stat-label">Tehtud:</span>
                          <span className="stat-value">{stats.completedItems}</span>
                        </span>
                        <span className="stat-item">
                          <span className="stat-label">Tegemata:</span>
                          <span className="stat-value">{pendingCount}</span>
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
