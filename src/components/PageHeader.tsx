import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiArrowLeft, FiMenu, FiTruck, FiCalendar, FiClipboard,
  FiFolder, FiAlertTriangle, FiShield, FiX, FiTool, FiChevronRight, FiSearch, FiLoader, FiBook
} from 'react-icons/fi';
import { PiCraneTowerFill } from 'react-icons/pi';
import { InspectionMode } from './MainMenu';
import { supabase, TrimbleExUser } from '../supabase';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';
import { isAdmin as checkIsAdmin } from '../constants/roles';

interface PageHeaderProps {
  title: string;
  subtitle?: string; // Small text shown above title
  onBack: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  currentMode?: InspectionMode;
  user?: TrimbleExUser | null;
  children?: React.ReactNode; // For custom actions in header
  onColorModelWhite?: () => void; // Callback to color all model objects white
  api?: any; // Trimble Connect API for quick search
  projectId?: string; // Project ID for database queries
  onSelectInspectionType?: (typeId: string, typeCode: string, typeName: string) => void; // Callback for inspection type selection
  onOpenPartDatabase?: () => void; // Callback to open Part Database section in Tools
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

// Nav items with translation keys
const getNavItems = (t: (key: string) => string): NavItem[] => [
  { mode: 'delivery_schedule', label: t('menu.deliverySchedules'), icon: <FiTruck size={18} />, color: '#059669' },
  { mode: 'schedule', label: t('menu.installationSchedules'), icon: <FiCalendar size={18} />, color: '#8b5cf6' },
  { mode: 'arrived_deliveries', label: t('menu.arrivals'), icon: <FiClipboard size={18} />, color: '#0891b2' },
  { mode: 'installations', label: t('menu.installations'), icon: <PiCraneTowerFill size={18} />, color: 'var(--modus-info)' },
  { mode: 'inspection_plans', label: t('menu.inspectionPlans'), icon: <FiClipboard size={18} />, color: '#10b981', hasSubmenu: true },
  { mode: 'issues', label: t('menu.nonConformances'), icon: <FiAlertTriangle size={18} />, color: '#dc2626' },
  { mode: 'organizer', label: t('menu.organizer'), icon: <FiFolder size={18} />, color: '#7c3aed' },
  { mode: 'tools', label: t('menu.tools'), icon: <FiTool size={18} />, color: '#f59e0b', hasSubmenu: true },
  { mode: 'keyboard_shortcuts', label: t('menu.guides'), icon: <FiBook size={18} />, color: '#8b5cf6' },
  { mode: 'inspection_plan', label: t('menu.inspectionPlan'), icon: <FiClipboard size={18} />, color: '#6b7280', adminOnly: true },
  { mode: 'admin', label: t('menu.admin'), icon: <FiShield size={18} />, color: '#6b7280', adminOnly: true },
  { mode: null, label: t('menu.mainMenu'), icon: <FiMenu size={18} />, color: '#6b7280' },
];

export default function PageHeader({
  title,
  subtitle,
  onBack,
  onNavigate,
  currentMode,
  user,
  children,
  onColorModelWhite,
  api,
  projectId,
  onSelectInspectionType,
  onOpenPartDatabase
}: PageHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get translated nav items
  const NAV_ITEMS = getNavItems(t);

  // Quick search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{ count: number; message: string } | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Inspection types state
  const [inspectionTypes, setInspectionTypes] = useState<Array<{ id: string; code: string; name: string; color: string }>>([]);

  const isAdmin = checkIsAdmin(user);

  // Load inspection types for submenu
  useEffect(() => {
    if (!projectId) return;

    async function loadInspectionTypes() {
      try {
        const { data: planItems, error } = await supabase
          .from('inspection_plan_items')
          .select(`
            inspection_type_id,
            inspection_types!inspection_plan_items_inspection_type_id_fkey (
              id, code, name, color, sort_order, is_active
            )
          `)
          .eq('project_id', projectId);

        if (error) throw error;

        // Get unique types
        const typeMap = new Map<string, any>();
        for (const item of planItems || []) {
          const typeData = item.inspection_types as any;
          if (typeData && typeData.is_active && typeData.code !== 'OTHER') {
            typeMap.set(typeData.id, typeData);
          }
        }

        // Sort by sort_order
        const sorted = Array.from(typeMap.values())
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(t => ({ id: t.id, code: t.code, name: t.name, color: t.color }));

        setInspectionTypes(sorted);
      } catch (e) {
        console.error('Error loading inspection types:', e);
      }
    }

    loadInspectionTypes();
  }, [projectId]);

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
  // Always uses exact match
  const handleQuickSearch = useCallback(async (query: string) => {
    if (!query.trim() || !api || !projectId) {
      setSearchResult(null);
      return;
    }

    setSearchLoading(true);
    setSearchResult(null);

    try {
      // Search in database for matching assembly_mark (exact match only)
      const dbQuery = supabase
        .from('trimble_model_objects')
        .select('guid_ifc, assembly_mark')
        .eq('trimble_project_id', projectId)
        .eq('assembly_mark', query.trim());

      const { data, error } = await dbQuery.limit(100);

      if (error) throw error;

      if (!data || data.length === 0) {
        setSearchResult({ count: 0, message: t('pageHeader.notFound', { query }) });
        setSearchLoading(false);
        return;
      }

      // Get unique GUIDs
      const guids = data.map(d => d.guid_ifc).filter(Boolean) as string[];

      if (guids.length === 0) {
        setSearchResult({ count: 0, message: t('pageHeader.noGuid', { query }) });
        setSearchLoading(false);
        return;
      }

      // Find objects in loaded models
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        setSearchResult({ count: data.length, message: t('pageHeader.foundInDb', { count: data.length }) });
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
        message: t('pageHeader.selectedInModel', { count: foundObjects.size })
      });
    } catch (e) {
      console.error('Quick search error:', e);
      setSearchResult({ count: 0, message: t('pageHeader.searchError') });
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
          title={t('pageHeader.back')}
        >
          <FiArrowLeft size={18} />
        </button>

        <div className="page-header-menu" ref={menuRef}>
          <button
            className={`page-header-hamburger ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            title={t('pageHeader.menu')}
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
                      placeholder={t('pageHeader.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => handleSearchInputChange(e.target.value)}
                    />
                    {searchLoading && <FiLoader size={14} className="quick-search-spinner spin" />}
                    {!searchLoading && searchQuery && (
                      <button
                        className="quick-search-clear"
                        onClick={clearSearch}
                        title={t('pageHeader.clear')}
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
                  {/* Kontrollid submenu */}
                  {item.hasSubmenu && item.mode === 'inspection_plans' && submenuOpen === 'inspection_plans' && (
                    <div className="submenu">
                      <button
                        className="submenu-item"
                        onClick={() => handleNavigate('inspection_plans')}
                      >
                        {t('pageHeader.allInspectionPlans')}
                      </button>
                      {inspectionTypes.map((type) => (
                        <button
                          key={type.id}
                          className="submenu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            setSubmenuOpen(null);
                            if (onSelectInspectionType) {
                              onSelectInspectionType(type.id, type.code, type.name);
                            }
                          }}
                        >
                          <span style={{ color: type.color, marginRight: '8px' }}>●</span>
                          {type.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Tööriistad submenu */}
                  {item.hasSubmenu && item.mode === 'tools' && submenuOpen === 'tools' && (
                    <div className="submenu">
                      <button
                        className="submenu-item"
                        onClick={() => handleNavigate('tools')}
                      >
                        {t('pageHeader.allTools')}
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => handleNavigate('crane_planner')}
                      >
                        {t('pageHeader.cranePlanning')}
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setSubmenuOpen(null);
                          if (onOpenPartDatabase) {
                            onOpenPartDatabase();
                          } else {
                            handleNavigate('tools');
                          }
                        }}
                      >
                        {t('pageHeader.partDatabase')}
                      </button>
                      <button
                        className="submenu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setSubmenuOpen(null);
                          onColorModelWhite?.();
                        }}
                      >
                        {t('pageHeader.colorModelWhite')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="page-header-title-wrapper">
          {subtitle && (
            <span className="page-header-subtitle">{subtitle}</span>
          )}
          <h1 className="page-header-title">{title}</h1>
        </div>
      </div>

      {children && (
        <div className="page-header-actions">
          {children}
        </div>
      )}
    </div>
  );
}
