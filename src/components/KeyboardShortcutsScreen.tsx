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
  title: string;
  description: string;
}

interface GuideCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  items: GuideItem[];
}

// Shortcut item definitions (descriptions resolved via i18n)
const shortcutItems = [
  { id: 'alt_shift_a', title: 'ALT + SHIFT + A', descKey: 'shortcuts.alt_shift_a_desc' },
  { id: 'alt_shift_m', title: 'ALT + SHIFT + M', descKey: 'shortcuts.alt_shift_m_desc' },
  { id: 'alt_shift_s', title: 'ALT + SHIFT + S', descKey: 'shortcuts.alt_shift_s_desc' },
  { id: 'alt_shift_w', title: 'ALT + SHIFT + W', descKey: 'shortcuts.alt_shift_w_desc' },
  { id: 'alt_shift_b', title: 'ALT + SHIFT + B', descKey: 'shortcuts.alt_shift_b_desc' },
  { id: 'alt_shift_i', title: 'ALT + SHIFT + I', descKey: 'shortcuts.alt_shift_i_desc' },
  { id: 'alt_shift_d', title: 'ALT + SHIFT + D', descKey: 'shortcuts.alt_shift_d_desc' },
  { id: 'alt_shift_r', title: 'ALT + SHIFT + R', descKey: 'shortcuts.alt_shift_r_desc' },
  { id: 'alt_shift_c', title: 'ALT + SHIFT + C', descKey: 'shortcuts.alt_shift_c_desc' },
  { id: 'alt_shift_t', title: 'ALT + SHIFT + T', descKey: 'shortcuts.alt_shift_t_desc' },
  { id: 'alt_shift_1', title: 'ALT + SHIFT + 1', descKey: 'shortcuts.alt_shift_1_desc' },
  { id: 'alt_shift_2', title: 'ALT + SHIFT + 2', descKey: 'shortcuts.alt_shift_2_desc' },
  { id: 'alt_shift_3', title: 'ALT + SHIFT + 3', descKey: 'shortcuts.alt_shift_3_desc' },
  { id: 'alt_shift_4', title: 'ALT + SHIFT + 4', descKey: 'shortcuts.alt_shift_4_desc' },
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

  // Build guide categories with translated descriptions
  const guideCategories: GuideCategory[] = useMemo(() => [
    {
      id: 'keyboard_shortcuts',
      name: t('shortcuts.globalShortcuts'),
      icon: <FiCommand size={18} />,
      items: shortcutItems.map(item => ({
        id: item.id,
        title: item.title,
        description: t(item.descKey)
      }))
    }
  ], [t]);

  // Filter items based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) {
      return guideCategories;
    }

    const query = searchQuery.toLowerCase();
    return guideCategories.map(category => ({
      ...category,
      items: category.items.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      )
    })).filter(category => category.items.length > 0);
  }, [searchQuery, guideCategories]);

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
        title={t('shortcuts.title')}
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
            placeholder={t('shortcuts.searchPlaceholder')}
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
            <div style={{ fontSize: '14px' }}>{t('shortcuts.noResults', { query: searchQuery })}</div>
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
                      {highlightText(category.name, searchQuery)}
                    </span>
                    <span style={{
                      color: '#9ca3af',
                      fontSize: '12px',
                      marginRight: '8px'
                    }}>
                      {category.items.length} {category.items.length === 1 ? t('shortcuts.topicSingular') : t('shortcuts.topicPlural')}
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
                              {highlightText(item.title, searchQuery)}
                            </code>
                          </div>

                          {/* Item description */}
                          <div style={{
                            fontSize: '13px',
                            color: '#4b5563',
                            lineHeight: 1.5,
                            paddingLeft: '2px'
                          }}>
                            {highlightText(item.description, searchQuery)}
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
                          <strong>{t('shortcuts.hint')}</strong> {t('shortcuts.hintText')}
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
