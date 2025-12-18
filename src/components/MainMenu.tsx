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

  // Load inspection types that have plan items for this project
  useEffect(() => {
    async function loadInspectionTypes() {
      setLoading(true);
      try {
        // Get inspection types that have plan items in this project
        const { data: planItems, error: planError } = await supabase
          .from('inspection_plan_items')
          .select(`
            inspection_type_id,
            status,
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
          if (item.status === 'completed') {
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
                      <span className="menu-item-desc">
                        {pendingCount > 0
                          ? `${pendingCount} tegemata / ${stats.totalItems} kokku`
                          : `${stats.totalItems} tehtud`
                        }
                      </span>
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
