import { useEffect, useState } from 'react';
import { TrimbleExUser, supabase } from '../supabase';
import {
  FiSearch, FiTool, FiAlertTriangle, FiChevronRight, FiSettings,
  FiShield, FiClipboard, FiBox, FiDroplet, FiZap, FiLayers,
  FiGrid, FiSquare, FiMoreHorizontal, FiLoader
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
  | 'inspection_type'; // New: for dynamic inspection types

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

  // Load ALL inspection types and determine which have plan items for this project
  useEffect(() => {
    async function loadInspectionTypes() {
      setLoading(true);
      try {
        // Get ALL active inspection types from database
        const { data: allTypes, error: typesError } = await supabase
          .from('inspection_types')
          .select('id, code, name, description, icon, color, sort_order, is_active')
          .eq('is_active', true)
          .neq('code', 'OTHER') // Skip "Muu" type
          .order('sort_order', { ascending: true });

        if (typesError) {
          console.error('Error loading inspection types:', typesError);
          setLoading(false);
          return;
        }

        // Get inspection plan items for this project to know which types are used
        const { data: planItems, error: planError } = await supabase
          .from('inspection_plan_items')
          .select('id, inspection_type_id, guid, guid_ifc')
          .eq('project_id', projectId);

        if (planError) {
          console.error('Error loading plan items:', planError);
          // Continue - we'll just show all types as inactive
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

        // Calculate stats per type from plan items
        const statsMap: Record<string, TypeStats> = {};

        for (const item of planItems || []) {
          if (!item.inspection_type_id) continue;

          if (!statsMap[item.inspection_type_id]) {
            statsMap[item.inspection_type_id] = {
              typeId: item.inspection_type_id,
              totalItems: 0,
              completedItems: 0
            };
          }

          statsMap[item.inspection_type_id].totalItems++;

          // Check if this plan item is completed
          const isCompleted = completedPlanItemIds.has(item.id) ||
            (item.guid && completedGuids.has(item.guid)) ||
            (item.guid_ifc && completedGuids.has(item.guid_ifc));

          if (isCompleted) {
            statsMap[item.inspection_type_id].completedItems++;
          }
        }

        setInspectionTypes(allTypes as InspectionType[]);
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
            <span className="menu-user-email">{user.user_email}</span>
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
              const hasPlanItems = stats && stats.totalItems > 0;
              const pendingCount = stats ? stats.totalItems - stats.completedItems : 0;
              const isMatched = matchedTypeIds.includes(type.id);
              const isCompleted = completedTypeIds.includes(type.id);
              // matched-completed = green (inspected), matched-pending = blue/gray (not yet)
              const matchClass = isMatched ? (isCompleted ? 'matched-completed' : 'matched-pending') : '';

              return (
                <button
                  key={type.id}
                  className={`menu-item ${hasPlanItems ? 'enabled' : 'no-plan-items'} ${matchClass}`}
                  onClick={() => hasPlanItems && handleTypeClick(type)}
                  disabled={!hasPlanItems}
                >
                  <span className="menu-item-icon" style={{ color: hasPlanItems ? (type.color || 'var(--modus-primary)') : 'var(--modus-text-tertiary)' }}>
                    <IconComponent size={20} />
                  </span>
                  <div className="menu-item-content">
                    <span className="menu-item-title">{type.name}</span>
                    {hasPlanItems ? (
                      <span className="menu-item-desc">
                        {pendingCount > 0
                          ? `${pendingCount} tegemata / ${stats.totalItems} kokku`
                          : `${stats.totalItems} tehtud`
                        }
                      </span>
                    ) : (
                      <span className="menu-item-desc no-plan">Pole määratud</span>
                    )}
                  </div>
                  <span className="menu-item-arrow">
                    <FiChevronRight size={18} />
                  </span>
                </button>
              );
            })}

            {/* Mitte vastavus - always visible but disabled for now */}
            <button
              className="menu-item disabled"
              disabled
            >
              <span className="menu-item-icon">
                <FiAlertTriangle size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Mitte vastavus</span>
                <span className="menu-item-desc">Arendamisel</span>
              </div>
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
