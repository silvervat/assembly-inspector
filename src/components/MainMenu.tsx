import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrimbleExUser, supabase } from '../supabase';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  FiTool, FiAlertTriangle, FiChevronRight, FiSettings,
  FiShield, FiClipboard, FiTruck, FiCalendar, FiFolder, FiSearch, FiBook, FiGlobe
} from 'react-icons/fi';
import { PiCraneTowerFill } from 'react-icons/pi';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';

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
  | 'inspection_plans' // Kontrollplaanid (kõik inspektsioonid)
  | 'inspection_admin' // Kontrollkavade admin paneel (v3.0)
  | 'inspection_type'
  | 'installations' // Paigaldamiste süsteem
  | 'schedule' // Paigaldusgraafik
  | 'delivery_schedule' // Tarnegraafik
  | 'arrived_deliveries' // Saabunud tarned
  | 'organizer' // Organiseeri (gruppide haldus)
  | 'issues' // Probleemid (mittevastavused)
  | 'tools' // Tööriistad
  | 'crane_planner' // Kraanade planeerimine
  | 'crane_library' // Kraanade andmebaas (admin)
  | 'keyboard_shortcuts'; // Klaviatuuri otseteed

interface MainMenuProps {
  user: TrimbleExUser;
  userInitials: string;
  projectId: string;
  api: WorkspaceAPI.WorkspaceAPI;
  onSelectMode: (mode: InspectionMode) => void;
  onOpenSettings?: () => void;
}

export default function MainMenu({
  user,
  userInitials,
  projectId,
  api,
  onSelectMode,
  onOpenSettings
}: MainMenuProps) {
  const { t, i18n } = useTranslation();
  const isAdmin = user.role === 'admin';
  const [activeIssuesCount, setActiveIssuesCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [exactMatch, setExactMatch] = useState(true);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);

  // Set language from user preference on mount
  useEffect(() => {
    if (user.preferred_language && user.preferred_language !== i18n.language) {
      i18n.changeLanguage(user.preferred_language);
    }
  }, [user.preferred_language, i18n]);

  // Change language and save to database
  const changeLanguage = async (lng: string) => {
    i18n.changeLanguage(lng);
    setShowLanguageMenu(false);

    // Save to database
    try {
      const { error } = await supabase
        .from('trimble_ex_users')
        .update({ preferred_language: lng })
        .eq('id', user.id);

      if (error) {
        console.error('Failed to save language preference:', error);
      }
    } catch (e) {
      console.error('Error saving language preference:', e);
    }
  };

  // Quick search function
  const handleQuickSearch = useCallback(async (query: string, exact: boolean) => {
    if (!query.trim()) {
      setSearchMessage(t('menu.searchEmpty'));
      setTimeout(() => setSearchMessage(null), 2000);
      return;
    }

    setSearching(true);
    setSearchMessage(null);

    try {
      // Search for assembly mark (exact or partial match)
      let dbQuery = supabase
        .from('trimble_model_objects')
        .select('guid_ifc, guid, assembly_mark, product_name')
        .eq('trimble_project_id', projectId);

      if (exact) {
        dbQuery = dbQuery.eq('assembly_mark', query.trim());
      } else {
        dbQuery = dbQuery.ilike('assembly_mark', `%${query.trim()}%`);
      }

      const { data: results, error } = await dbQuery.limit(500);

      if (error) throw error;

      if (!results || results.length === 0) {
        setSearchMessage(t('menu.notFound', { query }));
        setTimeout(() => setSearchMessage(null), 3000);
        return;
      }

      // Find objects in models
      const guids = results.map(r => r.guid_ifc || r.guid).filter(Boolean) as string[];
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        setSearchMessage(t('menu.notFoundInModel', { query }));
        setTimeout(() => setSearchMessage(null), 3000);
        return;
      }

      // Select and zoom to found objects
      const modelObjectIds = Array.from(foundObjects.values()).map(obj => ({
        modelId: obj.modelId,
        objectRuntimeIds: [obj.runtimeId]
      }));

      await api.viewer.setSelection({ modelObjectIds }, 'set');
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });

      setSearchMessage(`✓ ${t('menu.found', { mark: results[0].assembly_mark })}`);
      setTimeout(() => setSearchMessage(null), 2000);
      setSearchQuery('');
    } catch (e) {
      console.error('Quick search error:', e);
      setSearchMessage(t('menu.searchError'));
      setTimeout(() => setSearchMessage(null), 2000);
    } finally {
      setSearching(false);
    }
  }, [projectId, api, exactMatch, t]);

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
        <div className="menu-header-actions">
          {/* Language selector */}
          <div className="language-selector-wrapper">
            <button
              className="menu-language-btn"
              onClick={() => setShowLanguageMenu(!showLanguageMenu)}
              title={t('language.label')}
            >
              <FiGlobe size={18} />
              <span className="language-code">{i18n.language.toUpperCase()}</span>
            </button>
            {showLanguageMenu && (
              <div className="language-dropdown">
                <button
                  className={`language-option ${i18n.language === 'et' ? 'active' : ''}`}
                  onClick={() => changeLanguage('et')}
                >
                  🇪🇪 {t('language.et')}
                </button>
                <button
                  className={`language-option ${i18n.language === 'en' ? 'active' : ''}`}
                  onClick={() => changeLanguage('en')}
                >
                  🇬🇧 {t('language.en')}
                </button>
              </div>
            )}
          </div>
          <button className="menu-settings-btn" onClick={onOpenSettings} title={t('menu.settings')}>
            <FiSettings size={18} />
          </button>
        </div>
      </div>

      {/* Quick search */}
      <div className="main-menu-search">
        <div className="search-input-wrapper">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleQuickSearch(searchQuery, exactMatch);
              }
            }}
            placeholder={t('menu.searchPlaceholder')}
            className="search-input"
            disabled={searching}
          />
          <button
            className="search-button"
            onClick={() => handleQuickSearch(searchQuery, exactMatch)}
            disabled={searching || !searchQuery.trim()}
            title={t('buttons.search')}
          >
            {searching ? <span className="search-spinner">⏳</span> : <FiSearch size={16} />}
          </button>
        </div>
        {searchQuery.trim() && (
          <label className="search-checkbox">
            <input
              type="checkbox"
              checked={exactMatch}
              onChange={(e) => setExactMatch(e.target.checked)}
            />
            <span>{t('menu.exactMatch')}</span>
          </label>
        )}
        {searchMessage && (
          <div className={`search-message ${searchMessage.startsWith('✓') ? 'success' : 'error'}`}>
            {searchMessage}
          </div>
        )}
      </div>

      <div className="main-menu-items">
        {/* Tarnegraafik - delivery schedule */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('delivery_schedule')}
            >
              <span className="menu-item-icon" style={{ color: '#059669' }}>
                <FiTruck size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{t('menu.deliverySchedules')}</span>
                <span className="menu-item-desc">{t('menu.deliverySchedulesDesc')}</span>
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
                <span className="menu-item-title">{t('menu.installationSchedules')}</span>
                <span className="menu-item-desc">{t('menu.installationSchedulesDesc')}</span>
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
                <span className="menu-item-title">{t('menu.arrivals')}</span>
                <span className="menu-item-desc">{t('menu.arrivalsDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Paigaldamised - installations log */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('installations')}
            >
              <span className="menu-item-icon" style={{ color: 'var(--modus-info)' }}>
                <PiCraneTowerFill size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{t('menu.installations')}</span>
                <span className="menu-item-desc">{t('menu.installationsDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Kontrollplaanid - inspection plans */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('inspection_plans')}
            >
              <span className="menu-item-icon" style={{ color: '#10b981' }}>
                <FiClipboard size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{t('menu.inspectionPlans')}</span>
                <span className="menu-item-desc">{t('menu.inspectionPlansDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Mittevastavaused - issues and non-conformances (renamed from Probleemid) */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('issues')}
            >
              <span className="menu-item-icon" style={{ color: '#dc2626' }}>
                <FiAlertTriangle size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">
                  {t('menu.nonConformances')}
                  {activeIssuesCount > 0 && (
                    <span className="menu-badge">{activeIssuesCount}</span>
                  )}
                </span>
                <span className="menu-item-desc">{t('menu.nonConformancesDesc')}</span>
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
                <span className="menu-item-title">{t('menu.organizer')}</span>
                <span className="menu-item-desc">{t('menu.organizerDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Tööriistad - tools */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('tools')}
            >
              <span className="menu-item-icon" style={{ color: '#0891b2' }}>
                <FiTool size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{t('menu.tools')}</span>
                <span className="menu-item-desc">{t('menu.toolsDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

            {/* Kasutusjuhendid - guides */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('keyboard_shortcuts')}
            >
              <span className="menu-item-icon" style={{ color: '#8b5cf6' }}>
                <FiBook size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{t('menu.guides')}</span>
                <span className="menu-item-desc">{t('menu.guidesDesc')}</span>
              </div>
              <span className="menu-item-arrow">
                <FiChevronRight size={18} />
              </span>
            </button>

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
                <span className="menu-item-title">{t('menu.inspectionPlan')}</span>
                <span className="menu-item-desc">{t('menu.inspectionPlanDesc')}</span>
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
                <span className="menu-item-title">{t('menu.admin')}</span>
                <span className="menu-item-desc">{t('menu.adminDesc')}</span>
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
