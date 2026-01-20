import { useEffect, useState, useCallback } from 'react';
import { TrimbleExUser, supabase } from '../supabase';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  FiTool, FiAlertTriangle, FiChevronRight, FiSettings,
  FiShield, FiClipboard, FiTruck, FiCalendar, FiFolder, FiSearch
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
  | 'inspection_type'
  | 'installations' // Paigaldamiste süsteem
  | 'schedule' // Paigaldusgraafik
  | 'delivery_schedule' // Tarnegraafik
  | 'arrived_deliveries' // Saabunud tarned
  | 'organizer' // Organiseeri (gruppide haldus)
  | 'issues' // Probleemid (mittevastavused)
  | 'tools' // Tööriistad
  | 'crane_planner' // Kraanade planeerimine
  | 'crane_library'; // Kraanade andmebaas (admin)

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
  const isAdmin = user.role === 'admin';
  const [activeIssuesCount, setActiveIssuesCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [exactMatch, setExactMatch] = useState(true);

  // Quick search function
  const handleQuickSearch = useCallback(async (query: string, exact: boolean) => {
    if (!query.trim()) {
      setSearchMessage('Sisesta otsingu tekst');
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
        setSearchMessage(`Ei leidnud: ${query}`);
        setTimeout(() => setSearchMessage(null), 3000);
        return;
      }

      // Find objects in models
      const guids = results.map(r => r.guid_ifc || r.guid).filter(Boolean) as string[];
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      if (foundObjects.size === 0) {
        setSearchMessage(`Ei leidnud mudelist: ${query}`);
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

      setSearchMessage(`✓ Leitud: ${results[0].assembly_mark}`);
      setTimeout(() => setSearchMessage(null), 2000);
      setSearchQuery('');
    } catch (e) {
      console.error('Quick search error:', e);
      setSearchMessage('Viga otsingul');
      setTimeout(() => setSearchMessage(null), 2000);
    } finally {
      setSearching(false);
    }
  }, [projectId, api, exactMatch]);

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
        <button className="menu-settings-btn" onClick={onOpenSettings} title="Seaded">
          <FiSettings size={18} />
        </button>
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
            placeholder="Otsi assembly marki..."
            className="search-input"
            disabled={searching}
          />
          <button
            className="search-button"
            onClick={() => handleQuickSearch(searchQuery, exactMatch)}
            disabled={searching || !searchQuery.trim()}
            title="Otsi"
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
            <span>Täpne vaste</span>
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
                <span className="menu-item-title">Tarnegraafikud</span>
                <span className="menu-item-desc">Planeeri ja jälgi tarneid veokite kaupa</span>
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
                <span className="menu-item-title">Paigaldusgraafikud</span>
                <span className="menu-item-desc">Planeeri ja esitle paigaldusi</span>
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
                <span className="menu-item-title">Saabumised</span>
                <span className="menu-item-desc">Kontrolli ja kinnita saabunud veokite sisu</span>
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
                <span className="menu-item-title">Paigaldamised</span>
                <span className="menu-item-desc">Paigalduste päevik</span>
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
                <span className="menu-item-title">Kontrollplaanid</span>
                <span className="menu-item-desc">Inspektsioonide haldus ja täitmine</span>
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
                  Mittevastavaused
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

            {/* Tööriistad - tools */}
            <button
              className="menu-item enabled"
              onClick={() => onSelectMode('tools')}
            >
              <span className="menu-item-icon" style={{ color: '#0891b2' }}>
                <FiTool size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">Tööriistad</span>
                <span className="menu-item-desc">Ekspordid, markup'id ja märgistamine</span>
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
