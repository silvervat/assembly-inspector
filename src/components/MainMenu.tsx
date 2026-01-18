import { useEffect, useState } from 'react';
import { TrimbleExUser, supabase } from '../supabase';
import {
  FiSearch, FiTool, FiAlertTriangle, FiChevronRight, FiSettings,
  FiShield, FiClipboard, FiBox, FiDroplet, FiZap, FiLayers,
  FiGrid, FiSquare, FiMoreHorizontal, FiLoader, FiTruck, FiCalendar, FiFolder
} from 'react-icons/fi';
import { IconType } from 'react-icons';

export type InspectionMode =
  | 'paigaldatud'
  | 'poldid'
  | 'muu'
  | 'mittevastavus'
  | 'varviparandus'
  | 'keevis'
  | 'paigaldatud_detailid'
  | 'eos2'
  | 'admin'
  | 'inspection_plan'
  | 'inspection_type'
  | 'installations' // Paigaldamiste süsteem
  | 'schedule' // Paigaldusgraafik
  | 'delivery_schedule' // Tarnegraafik
  | 'arrived_deliveries' // Saabunud tarned
  | 'organizer' // Organiseeri (gruppide haldus)
  | 'issues' // Probleemid (mittevastavused)
  | 'tools' // Tööriistad
  | 'crane_planner' // Kraanide planeerimine
  | 'crane_library'; // Kraanide andmebaas (admin)

interface MainMenuProps {
  user: TrimbleExUser;
  userInitials: string;
  projectId: string;
  onSelectMode: (mode: InspectionMode) => void;
  onSelectInspectionType?: (typeId: string, typeCode: string, typeName: string) => void;
  onOpenSettings?: () => void;
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

export default function MainMenu({
  user,
  userInitials,
  projectId,
  onSelectMode,
  onSelectInspectionType,
  onOpenSettings,
  matchedTypeIds = [],
  completedTypeIds = []
}: MainMenuProps) {
  const isAdmin = user.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [inspectionTypes, setInspectionTypes] = useState<InspectionType[]>([]);
  const [typeStats, setTypeStats] = useState<Record<string, TypeStats>>({});
  const [activeIssuesCount, setActiveIssuesCount] = useState(0);

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

  // Load active issues count for badge
  useEffect(() => {
    async function loadActiveIssuesCount() {
      try {
        const { count, error } = await supabase
          .from('issues')
          .select('id', { count: 'exact', head: true })
          .eq('trimble_project_id', projectId)
          .not('status', 'in', '("closed","cancelled")');

        if (!error && count !== null) {
          setActiveIssuesCount(count);
        }
      } catch (e) {
        console.error('Error loading issues count:', e);
      }
    }

    if (projectId) {
      loadActiveIssuesCount();
    }
  }, [projectId]);

  const getIcon = (iconName: string): IconType => {
    return iconMap[iconName] || FiSearch;
  };

  const handleTypeClick = (type: InspectionType) => {
    if (onSelectInspectionType) {
      onSelectInspectionType(type.id, type.code, type.name);
    }
  };

  return (
    <div className="main-menu-container">
      <div className="main-menu-header">
        <div className="menu-user-info">
          <span className="menu-user-avatar">{userInitials}</span>
          <div className="menu-user-details">
            <span className="menu-user-email">{user.email}</span>
            <span className="menu-user-role">{user.role?.toUpperCase()}</span>
          </div>
        </div>
        <button className="menu-settings-btn" onClick={onOpenSettings} title="Seaded">
          <FiSettings size={18} />
        </button>
      </div>

      <div className="main-menu-items">
        {loading ? (
          <div className="menu-loading">
            <FiLoader className="spinner" size={24} />
            <span>Laadin inspektsiooni tüüpe...</span>
          </div>
        ) : inspectionTypes.length === 0 ? (
          <div className="menu-empty">
            <FiClipboard size={32} />
            <span>Selles projektis pole veel inspektsiooni kava</span>
            {isAdmin && (
              <button
                className="menu-create-plan-btn"
                onClick={() => onSelectMode('inspection_plan')}
              >
                Koosta inspektsiooni kava
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Dynamic inspection types from database */}
            {inspectionTypes.map((type) => {
              const IconComponent = getIcon(type.icon);
              const stats = typeStats[type.id];
              const pendingCount = stats ? stats.totalItems - stats.completedItems : 0;
              const isMatched = matchedTypeIds.includes(type.id);
              const isCompleted = completedTypeIds.includes(type.id);
              // matched-completed = green (inspected), matched-pending = blue/gray (not yet)
              const matchClass = isMatched ? (isCompleted ? 'matched-completed' : 'matched-pending') : '';

              return (
                <button
                  key={type.id}
                  className={`menu-item enabled ${matchClass}`}
                  onClick={() => handleTypeClick(type)}
                >
                  <span className="menu-item-icon" style={{ color: type.color || 'var(--modus-primary)' }}>
                    <IconComponent size={20} />
                  </span>
                  <div className="menu-item-content">
                    <span className="menu-item-title">{type.name}</span>
                    {stats && (
                      <>
                        <span className="menu-item-desc">
                          {pendingCount > 0
                            ? `${pendingCount} tegemata / ${stats.totalItems} kokku`
                            : `${stats.totalItems} tehtud`
                          }
                        </span>
                        {stats.totalItems > 0 && (
                          <div className="menu-item-progress">
                            <div
                              className="menu-item-progress-bar"
                              style={{ width: `${(stats.completedItems / stats.totalItems) * 100}%` }}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <span className="menu-item-arrow">
                    <FiChevronRight size={18} />
                  </span>
                </button>
              );
            })}

            {/* Paigaldamised - installations log */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('installations')}
            >
              <span className="menu-item-icon" style={{ color: 'var(--modus-info)' }}>
                <FiTruck size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Paigaldamised</span>
                <span className="menu-item-desc">Paigalduste päevik</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Paigaldusgraafik - installation schedule */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('schedule')}
            >
              <span className="menu-item-icon" style={{ color: '#8b5cf6' }}>
                <FiCalendar size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Paigaldusgraafik</span>
                <span className="menu-item-desc">Planeeri ja esitle paigaldusi</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Tarnegraafik - delivery schedule */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('delivery_schedule')}
            >
              <span className="menu-item-icon" style={{ color: '#059669' }}>
                <FiTruck size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Tarnegraafik</span>
                <span className="menu-item-desc">Planeeri ja jälgi tarneid veokite kaupa</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Saabunud tarned - arrived deliveries */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('arrived_deliveries')}
            >
              <span className="menu-item-icon" style={{ color: '#0891b2' }}>
                <FiClipboard size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Saabunud tarned</span>
                <span className="menu-item-desc">Kontrolli ja kinnita saabunud veokite sisu</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Organiseeri - group management */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('organizer')}
            >
              <span className="menu-item-icon" style={{ color: '#7c3aed' }}>
                <FiFolder size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Organiseerija</span>
                <span className="menu-item-desc">Grupeeri ja organiseeri detaile</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Probleemid - issues and non-conformances */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('issues')}
            >
              <span className="menu-item-icon" style={{ color: '#dc2626' }}>
                <FiAlertTriangle size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">
                  Probleemid
                  {activeIssuesCount > 0 && (
                    <span className="menu-badge">{activeIssuesCount}</span>
                  )}
                </span>
                <span className="menu-item-desc">Mittevastavused ja probleemide haldus</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

          </>
        )}

        {/* Admin menu - only visible for admin users */}
        {isAdmin && (
          <>
            <div className="menu-divider" />
            <button
              className="menu-item admin-menu-item enabled"
              onClick={() => onSelectMode('inspection_plan')}
            >
              <span className="menu-item-icon plan-icon">
                <FiClipboard size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Inspektsiooni kava</span>
                <span className="menu-item-desc">Koosta inspektsiooni kava</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>
            <button
              className="menu-item admin-menu-item enabled"
              onClick={() => onSelectMode('admin')}
            >
              <span className="menu-item-icon admin-icon">
                <FiShield size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Administratsioon</span>
                <span className="menu-item-desc">Admin tööriistad</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
