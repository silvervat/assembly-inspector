import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FiArrowLeft, FiMenu, FiTruck, FiCalendar, FiClipboard,
  FiFolder, FiAlertTriangle, FiShield, FiX, FiTool, FiChevronRight, FiSearch, FiLoader
} from 'react-icons/fi';
import { InspectionMode } from './MainMenu';
import { supabase, TrimbleExUser } from '../supabase';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  currentMode?: InspectionMode;
  user?: TrimbleExUser | null;
  children?: React.ReactNode; // For custom actions in header
  onColorModelWhite?: () => void; // Callback to color all model objects white
  api?: any; // Trimble Connect API for quick search
  projectId?: string; // Project ID for database queries
}

// Navigation items
interface NavItem {
  mode: InspectionMode | null;
  label: string;
  icon: React.ReactNode;
  color: string;
  adminOnly?: boolean;
  hasSubmenu?: boolean; // If true, shows submenu on hover
}

const NAV_ITEMS: NavItem[] = [
  { mode: 'installations', label: 'Paigaldamised', icon: <FiTruck size={18} />, color: 'var(--modus-info)' },
  { mode: 'schedule', label: 'Paigaldusgraafik', icon: <FiCalendar size={18} />, color: '#8b5cf6' },
  { mode: 'delivery_schedule', label: 'Tarnegraafik', icon: <FiTruck size={18} />, color: '#059669' },
  { mode: 'arrived_deliveries', label: 'Saabunud tarned', icon: <FiClipboard size={18} />, color: '#0891b2' },
  { mode: 'organizer', label: 'Organiseerija', icon: <FiFolder size={18} />, color: '#7c3aed' },
  { mode: 'issues', label: 'Probleemid', icon: <FiAlertTriangle size={18} />, color: '#dc2626' },
  { mode: 'crane_planner', label: 'Kraanide Planeerimine', icon: <FiTool size={18} />, color: '#f97316' },
  { mode: 'tools', label: 'Tööriistad', icon: <FiTool size={18} />, color: '#f59e0b', hasSubmenu: true },
  { mode: 'inspection_plan', label: 'Inspektsiooni kava', icon: <FiClipboard size={18} />, color: '#6b7280', adminOnly: true },
  { mode: 'admin', label: 'Administratsioon', icon: <FiShield size={18} />, color: '#6b7280', adminOnly: true },
  { mode: 'crane_library', label: 'Kraanide Andmebaas', icon: <FiTool size={18} />, color: '#f97316', adminOnly: true },
  { mode: null, label: 'Peamenüü', icon: <FiMenu size={18} />, color: '#6b7280' },
];

export default function PageHeader({
  title,
  onBack,
  onNavigate,
  currentMode,
  user,
  children,
  onColorModelWhite,
  api,
  projectId
}: PageHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Quick search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{ count: number; message: string } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isAdmin = user?.role === 'admin';

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  // Clear search when menu closes
  useEffect(() => {
    if (!menuOpen) {
      setSearchQuery('');
      setSearchResult(null);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    }
  }, [menuOpen]);

  // Filter nav items based on admin status
  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  const handleNavigate = (mode: InspectionMode | null) => {
    setMenuOpen(false);
    setSearchQuery('');
    setSearchResult(null);
    if (onNavigate) {
      onNavigate(mode);
    } else if (mode === null) {
      onBack();
    }
  };

  // Quick search - search by Cast Unit Mark in database and select in model
  const handleQuickSearch = useCallback(async (query: string) => {
    if (!query.trim() || !api || !projectId) {
      setSearchResult(null);
      return;
    }

    setSearchLoading(true);
    setSearchResult(null);

    try {
      // Search in database for matching assembly_mark (case-insensitive, partial match)
      const { data, error } = await supabase
        .from('trimble_model_objects')
        .select('guid_ifc, assembly_mark')
        .eq('trimble_project_id', projectId)
        .ilike('assembly_mark', `%${query.trim()}%`)
        .limit(100);

      if (error) throw error;

      if (!data || data.length === 0) {
        setSearchResult({ count: 0, message: `"${query}" - ei leitud` });
        setSearchLoading(false);
        return;
      }

      // Get unique GUIDs
      const guids = data.map(d => d.guid_ifc).filter(Boolean) as string[];

      if (guids.length === 0) {
        setSearchResult({ count: 0, message: `"${query}" - GUID puudub` });
        setSearchLoading(false);
        return;
      }

      // Find objects in loaded models
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        setSearchResult({ count: data.length, message: `${data.length} leitud andmebaasist, mudel pole laaditud` });
        setSearchLoading(false);
        return;
      }

      // Group by model for selection
      const modelSelection: { modelId: string; objectRuntimeIds: number[] }[] = [];
      const byModel: Record<string, number[]> = {};

      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        modelSelection.push({ modelId, objectRuntimeIds: runtimeIds });
      }

      // Select objects in model
      await api.viewer.setSelection({ modelObjectIds: modelSelection }, 'set');

      // Zoom to selection if only a few objects
      if (foundObjects.size <= 10) {
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
      }

      setSearchResult({
        count: foundObjects.size,
        message: `${foundObjects.size} detaili valitud mudelis`
      });
    } catch (e) {
      console.error('Quick search error:', e);
      setSearchResult({ count: 0, message: 'Otsingu viga' });
    } finally {
      setSearchLoading(false);
    }
  }, [api, projectId]);

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResult(null);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  };

  // Debounced search on input change - faster with shorter delay
  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search - shorter delay for faster response
    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        handleQuickSearch(value);
      }, 300);
    } else {
      setSearchResult(null);
    }
  };

  return (
    <div className="page-header">
      <div className="page-header-left">
        <button
          className="page-header-back"
          onClick={onBack}
          title="Tagasi"
        >
          <FiArrowLeft size={18} />
        </button>

        <div className="page-header-menu" ref={menuRef}>
          <button
            className={`page-header-hamburger ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            title="Menüü"
          >
            {menuOpen ? <FiX size={18} /> : <FiMenu size={18} />}
          </button>

          {menuOpen && (
            <div className="page-header-dropdown">
              {/* Quick search */}
              {api && projectId && (
                <div className="quick-search-container">
                  <div className="quick-search-input-wrap">
                    <FiSearch size={14} className="quick-search-icon" />
                    <input
                      type="text"
                      className="quick-search-input"
                      placeholder="Otsi Cast Unit Mark..."
                      value={searchQuery}
                      onChange={(e) => handleSearchInputChange(e.target.value)}
                    />
                    {searchLoading && <FiLoader size={14} className="quick-search-spinner spin" />}
                    {!searchLoading && searchQuery && (
                      <button
                        className="quick-search-clear"
                        onClick={clearSearch}
                        title="Tühjenda"
                      >
                        <FiX size={14} />
                      </button>
                    )}
                  </div>
                  {searchResult && (
                    <div className={`quick-search-result ${searchResult.count > 0 ? 'success' : 'empty'}`}>
                      {searchResult.message}
                    </div>
                  )}
                  <div className="quick-search-divider" />
                </div>
              )}
              {visibleItems.map((item) => (
                <div
                  key={item.mode || 'main'}
                  style={{ position: 'relative' }}
                  onMouseEnter={() => item.hasSubmenu && setSubmenuOpen(item.mode)}
                  onMouseLeave={() => item.hasSubmenu && setSubmenuOpen(null)}
                >
                  <button
                    className={`dropdown-item ${currentMode === item.mode ? 'active' : ''} ${item.hasSubmenu ? 'has-submenu' : ''}`}
                    onClick={() => !item.hasSubmenu && handleNavigate(item.mode)}
                  >
                    <span className="dropdown-icon" style={{ color: item.color }}>
                      {item.icon}
                    </span>
                    <span className="dropdown-label">{item.label}</span>
                    {item.hasSubmenu && (
                      <span className="submenu-arrow">
                        <FiChevronRight size={14} />
                      </span>
                    )}
                  </button>
                  {/* Tööriistad submenu */}
                  {item.hasSubmenu && item.mode === 'tools' && submenuOpen === 'tools' && (
                    <div className="submenu">
                      <button
                        className="submenu-item"
                        onClick={() => handleNavigate('tools')}
                      >
                        Kõik tööriistad
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setSubmenuOpen(null);
                          onColorModelWhite?.();
                        }}
                      >
                        Värvi mudel valgeks
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <h1 className="page-header-title">{title}</h1>
      </div>

      {children && (
        <div className="page-header-actions">
          {children}
        </div>
      )}
    </div>
  );
}
