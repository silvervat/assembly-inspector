import { FiSearch, FiX } from 'react-icons/fi';
import type { OrganizerGroup, OrganizerGroupItem, CustomFieldDefinition } from '../../../supabase';

type SortField = 'sort_order' | 'name' | 'itemCount' | 'totalWeight' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface OrganizerSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showFilterMenu: boolean;
  onToggleFilterMenu: (show: boolean) => void;
  showSortMenu: boolean;
  onToggleSortMenu: (show: boolean) => void;
  searchFilterGroup: string;
  onFilterGroupChange: (groupId: string) => void;
  searchFilterColumn: string;
  onFilterColumnChange: (column: string) => void;
  groupSortField: SortField;
  onGroupSortFieldChange: (field: SortField) => void;
  groupSortDir: SortDirection;
  onGroupSortDirChange: (dir: SortDirection) => void;
  groups: OrganizerGroup[];
  groupItems: Map<string, OrganizerGroupItem[]>;
  allCustomFields: CustomFieldDefinition[];
  onCloseMenus: () => void;
  t: (key: string) => string;
}

export function OrganizerSearchBar({
  searchQuery,
  onSearchChange,
  showFilterMenu,
  onToggleFilterMenu,
  showSortMenu,
  onToggleSortMenu,
  searchFilterGroup,
  onFilterGroupChange,
  searchFilterColumn,
  onFilterColumnChange,
  groupSortField,
  onGroupSortFieldChange,
  groupSortDir,
  onGroupSortDirChange,
  groups,
  groupItems,
  allCustomFields,
  onCloseMenus,
  t
}: OrganizerSearchBarProps) {
  return (
    <div className="org-search-bar">
      <div className="org-search-group">
        <div className="org-search">
          <FiSearch size={14} />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && <button onClick={() => onSearchChange('')}><FiX size={14} /></button>}
        </div>

        {/* Filter button with dropdown */}
        <div className="org-filter-dropdown-container">
          <button
            className={`org-filter-icon-btn ${showFilterMenu ? 'active' : ''} ${(searchFilterGroup !== 'all' || searchFilterColumn !== 'all') ? 'has-filter' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSortMenu(false);
              onCloseMenus();
              onToggleFilterMenu(!showFilterMenu);
            }}
            title={t('organizer:ui.filter')}
          >
            <i className="modus-icons" style={{ fontSize: '18px' }}>filter</i>
          </button>
          {showFilterMenu && (
            <div className="org-filter-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="org-filter-dropdown-section">
                <label>Grupp</label>
                <select
                  value={searchFilterGroup}
                  onChange={(e) => onFilterGroupChange(e.target.value)}
                >
                  <option value="all">{t('organizer:search.all')}</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{'—'.repeat(g.level)} {g.name}</option>
                  ))}
                </select>
              </div>
              <div className="org-filter-dropdown-section">
                <label>Veerg</label>
                <select
                  value={searchFilterColumn}
                  onChange={(e) => onFilterColumnChange(e.target.value)}
                >
                  <option value="all">{t('organizer:search.allColumns')}</option>
                  <option value="mark">{t('organizer:excelHeaders.mark')}</option>
                  <option value="product">{t('organizer:excelHeaders.product')}</option>
                  <option value="weight">{t('organizer:excelHeaders.weight')}</option>
                  {allCustomFields.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              {(searchFilterGroup !== 'all' || searchFilterColumn !== 'all') && (
                <button
                  className="org-filter-clear-btn"
                  onClick={() => {
                    onFilterGroupChange('all');
                    onFilterColumnChange('all');
                  }}
                >
                  Tühista filtrid
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sort button with dropdown */}
        <div className="org-sort-dropdown-container">
          <button
            className={`org-sort-icon-btn ${showSortMenu ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFilterMenu(false);
              onCloseMenus();
              onToggleSortMenu(!showSortMenu);
            }}
            title={t('organizer:ui.sort')}
          >
            <i className="modus-icons" style={{ fontSize: '18px' }}>sort</i>
          </button>
          {showSortMenu && (
            <div className="org-sort-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="org-sort-dropdown-header">Gruppide sortimine</div>
              <button
                className={groupSortField === 'sort_order' ? 'active' : ''}
                onClick={() => { onGroupSortFieldChange('sort_order'); }}
              >
                Järjekord {groupSortField === 'sort_order' && (groupSortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={groupSortField === 'name' ? 'active' : ''}
                onClick={() => { onGroupSortFieldChange('name'); }}
              >
                Nimi {groupSortField === 'name' && (groupSortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={groupSortField === 'itemCount' ? 'active' : ''}
                onClick={() => { onGroupSortFieldChange('itemCount'); }}
              >
                Kogus {groupSortField === 'itemCount' && (groupSortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={groupSortField === 'totalWeight' ? 'active' : ''}
                onClick={() => { onGroupSortFieldChange('totalWeight'); }}
              >
                Kaal {groupSortField === 'totalWeight' && (groupSortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                className={groupSortField === 'created_at' ? 'active' : ''}
                onClick={() => { onGroupSortFieldChange('created_at'); }}
              >
                Loodud {groupSortField === 'created_at' && (groupSortDir === 'asc' ? '↑' : '↓')}
              </button>
              <div className="org-sort-dropdown-divider" />
              <button onClick={() => onGroupSortDirChange(groupSortDir === 'asc' ? 'desc' : 'asc')}>
                {groupSortDir === 'asc' ? '↑ Kasvav' : '↓ Kahanev'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="org-toolbar-stats">
        <span>{groups.length} gruppi</span>
        <span className="separator">|</span>
        <span>{Array.from(groupItems.values()).flat().length} detaili</span>
      </div>
    </div>
  );
}
