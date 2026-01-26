import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiChevronDown, FiChevronRight, FiSearch, FiCommand } from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';
import { TrimbleExUser } from '../supabase';

interface KeyboardShortcutsScreenProps {
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  user?: TrimbleExUser | null;
  onColorModelWhite?: () => void;
  api?: any;
  projectId?: string;
  onSelectInspectionType?: (typeId: string, typeCode: string, typeName: string) => void;
  onOpenPartDatabase?: () => void;
}

interface GuideItem {
  id: string;
  shortcutKey: string;
  descriptionKey: string;
}

interface GuideCategory {
  id: string;
  nameKey: string;
  icon: React.ReactNode;
  items: GuideItem[];
}

// Guide categories and items - using translation keys
const guideCategories: GuideCategory[] = [
  {
    id: 'keyboard_shortcuts',
    nameKey: 'guides.globalShortcuts',
    icon: <FiCommand size={18} />,
    items: [
      { id: 'alt_shift_a', shortcutKey: 'ALT + SHIFT + A', descriptionKey: 'shortcuts.altShiftA' },
      { id: 'alt_shift_m', shortcutKey: 'ALT + SHIFT + M', descriptionKey: 'shortcuts.altShiftM' },
      { id: 'alt_shift_s', shortcutKey: 'ALT + SHIFT + S', descriptionKey: 'shortcuts.altShiftS' },
      { id: 'alt_shift_w', shortcutKey: 'ALT + SHIFT + W', descriptionKey: 'shortcuts.altShiftW' },
      { id: 'alt_shift_b', shortcutKey: 'ALT + SHIFT + B', descriptionKey: 'shortcuts.altShiftB' },
      { id: 'alt_shift_i', shortcutKey: 'ALT + SHIFT + I', descriptionKey: 'shortcuts.altShiftI' },
      { id: 'alt_shift_d', shortcutKey: 'ALT + SHIFT + D', descriptionKey: 'shortcuts.altShiftD' },
      { id: 'alt_shift_r', shortcutKey: 'ALT + SHIFT + R', descriptionKey: 'shortcuts.altShiftR' },
      { id: 'alt_shift_c', shortcutKey: 'ALT + SHIFT + C', descriptionKey: 'shortcuts.altShiftC' },
      { id: 'alt_shift_t', shortcutKey: 'ALT + SHIFT + T', descriptionKey: 'shortcuts.altShiftT' },
      { id: 'alt_shift_1', shortcutKey: 'ALT + SHIFT + 1', descriptionKey: 'shortcuts.altShift1' },
      { id: 'alt_shift_2', shortcutKey: 'ALT + SHIFT + 2', descriptionKey: 'shortcuts.altShift2' },
      { id: 'alt_shift_3', shortcutKey: 'ALT + SHIFT + 3', descriptionKey: 'shortcuts.altShift3' },
      { id: 'alt_shift_4', shortcutKey: 'ALT + SHIFT + 4', descriptionKey: 'shortcuts.altShift4' }
    ]
  }
];

export default function KeyboardShortcutsScreen({
  onBackToMenu,
  onNavigate,
  user,
  onColorModelWhite,
  api,
  projectId,
  onSelectInspectionType,
  onOpenPartDatabase
}: KeyboardShortcutsScreenProps) {
  const { t } = useTranslation('common');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Filter items based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return guideCategories;
    }

    const query = searchQuery.toLowerCase();
    return guideCategories.map(category => ({
      ...category,
      items: category.items.filter(item =>
        item.shortcutKey.toLowerCase().includes(query) ||
        t(item.descriptionKey).toLowerCase().includes(query)
      )
    })).filter(category => category.items.length > 0);
  }, [searchQuery, t]);

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // Highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} style={{ background: '#fef08a', padding: '0 2px', borderRadius: '2px' }}>{part}</mark>
        : part
    );
  };

  return (
    <div className="screen-container" style={{
      background: '#f5f5f5',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      <PageHeader
        title={t('guides.title')}
        onBack={onBackToMenu}
        onNavigate={onNavigate}
        currentMode="keyboard_shortcuts"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
        onSelectInspectionType={onSelectInspectionType}
        onOpenPartDatabase={onOpenPartDatabase}
      />

      {/* Search bar */}
      <div style={{
        padding: '12px 16px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: '#f3f4f6',
          borderRadius: '8px',
          padding: '8px 12px'
        }}>
          <FiSearch size={18} style={{ color: '#9ca3af', flexShrink: 0 }} />
          <input
            type="text"
            placeholder={t('guides.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: '14px',
              outline: 'none',
              color: '#1f2937'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '2px',
                fontSize: '16px',
                lineHeight: 1
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content with visible scrollbar */}
      <div
        className="keyboard-shortcuts-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          padding: '16px',
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e1 #f1f5f9'
        }}
      >
        {filteredCategories.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#6b7280'
          }}>
            <div style={{ fontSize: '14px' }}>{t('guides.noResults', { query: searchQuery })}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredCategories.map(category => {
              const isExpanded = expandedCategories.has(category.id) || searchQuery.trim().length > 0;

              return (
                <div
                  key={category.id}
                  style={{
                    background: '#fff',
                    borderRadius: '10px',
                    border: '1px solid #e5e7eb',
                    overflow: 'hidden'
                  }}
                >
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(category.id)}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      background: isExpanded ? '#f8fafc' : '#fff',
                      border: 'none',
                      borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                  >
                    <span style={{ color: '#6366f1' }}>{category.icon}</span>
                    <span style={{
                      flex: 1,
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '15px',
                      color: '#1f2937'
                    }}>
                      {highlightText(t(category.nameKey), searchQuery)}
                    </span>
                    <span style={{
                      color: '#9ca3af',
                      fontSize: '12px',
                      marginRight: '8px'
                    }}>
                      {category.items.length} {category.items.length === 1 ? t('guides.topic') : t('guides.topics')}
                    </span>
                    {isExpanded ? (
                      <FiChevronDown size={18} style={{ color: '#9ca3af' }} />
                    ) : (
                      <FiChevronRight size={18} style={{ color: '#9ca3af' }} />
                    )}
                  </button>

                  {/* Category items */}
                  {isExpanded && (
                    <div style={{ padding: '8px' }}>
                      {category.items.map((item, index) => (
                        <div
                          key={item.id}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '8px',
                            background: index % 2 === 0 ? '#fafafa' : '#fff',
                            marginBottom: index < category.items.length - 1 ? '6px' : 0
                          }}
                        >
                          {/* Item title (shortcut key) */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '8px'
                          }}>
                            <code style={{
                              background: '#e0e7ff',
                              color: '#4338ca',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              fontFamily: 'ui-monospace, monospace',
                              border: '1px solid #c7d2fe'
                            }}>
                              {highlightText(item.shortcutKey, searchQuery)}
                            </code>
                          </div>

                          {/* Item description */}
                          <div style={{
                            fontSize: '13px',
                            color: '#4b5563',
                            lineHeight: 1.5,
                            paddingLeft: '2px'
                          }}>
                            {highlightText(t(item.descriptionKey), searchQuery)}
                          </div>
                        </div>
                      ))}

                      {/* Hint note at end of keyboard shortcuts section */}
                      {category.id === 'keyboard_shortcuts' && (
                        <div style={{
                          marginTop: '12px',
                          padding: '12px 14px',
                          background: '#fef3c7',
                          borderRadius: '8px',
                          border: '1px solid #fcd34d',
                          fontSize: '12px',
                          color: '#92400e',
                          lineHeight: 1.5
                        }}>
                          <strong>{t('guides.hint')}</strong> {t('guides.hintText')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
