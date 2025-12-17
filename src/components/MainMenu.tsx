import { TrimbleExUser } from '../supabase';
import { FiSearch, FiTool, FiFileText, FiAlertTriangle, FiDroplet, FiZap, FiPackage, FiUpload, FiChevronRight, FiSettings, FiShield } from 'react-icons/fi';
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
  | 'admin';

interface MainMenuProps {
  user: TrimbleExUser;
  userInitials: string;
  onSelectMode: (mode: InspectionMode) => void;
  onOpenSettings?: () => void;
}

interface MenuItem {
  mode: InspectionMode;
  title: string;
  icon: IconType;
  enabled: boolean;
  description?: string;
}

const menuItems: MenuItem[] = [
  {
    mode: 'paigaldatud',
    title: 'Paigaldatud detailide inspektsioon',
    icon: FiSearch,
    enabled: true,
    description: 'Assembly Selection SEES'
  },
  {
    mode: 'poldid',
    title: 'Poltide inspektsioon',
    icon: FiTool,
    enabled: true,
    description: 'Assembly Selection VÄLJAS'
  },
  {
    mode: 'muu',
    title: 'Muu inspektsioon',
    icon: FiFileText,
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'mittevastavus',
    title: 'Mitte vastavus',
    icon: FiAlertTriangle,
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'varviparandus',
    title: 'Värviparandused inspektsioon',
    icon: FiDroplet,
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'keevis',
    title: 'Keeviste inspektsioon',
    icon: FiZap,
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'paigaldatud_detailid',
    title: 'Paigaldatud detailid',
    icon: FiPackage,
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'eos2',
    title: 'Saada EOS2 tabelisse',
    icon: FiUpload,
    enabled: false,
    description: 'Arendamisel'
  }
];

export default function MainMenu({ user, userInitials, onSelectMode, onOpenSettings }: MainMenuProps) {
  const isAdmin = user.role === 'admin';

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
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <button
              key={item.mode}
              className={`menu-item ${item.enabled ? 'enabled' : 'disabled'}`}
              onClick={() => item.enabled && onSelectMode(item.mode)}
              disabled={!item.enabled}
            >
              <span className="menu-item-icon">
                <IconComponent size={20} />
              </span>
              <div className="menu-item-content">
                <span className="menu-item-title">{item.title}</span>
                {item.description && (
                  <span className="menu-item-desc">{item.description}</span>
                )}
              </div>
              {item.enabled && (
                <span className="menu-item-arrow">
                  <FiChevronRight size={18} />
                </span>
              )}
            </button>
          );
        })}

        {/* Admin menu - only visible for admin users */}
        {isAdmin && (
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
        )}
      </div>
    </div>
  );
}
