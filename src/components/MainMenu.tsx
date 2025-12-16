import { TrimbleExUser } from '../supabase';

export type InspectionMode =
  | 'paigaldatud'
  | 'poldid'
  | 'muu'
  | 'mittevastavus'
  | 'varviparandus'
  | 'keevis'
  | 'paigaldatud_detailid'
  | 'eos2';

interface MainMenuProps {
  user: TrimbleExUser;
  userInitials: string;
  onSelectMode: (mode: InspectionMode) => void;
  onLogout: () => void;
}

interface MenuItem {
  mode: InspectionMode;
  title: string;
  icon: string;
  enabled: boolean;
  description?: string;
}

const menuItems: MenuItem[] = [
  {
    mode: 'paigaldatud',
    title: 'Paigaldatud detailide inspektsioon',
    icon: '🔍',
    enabled: true,
    description: 'Assembly Selection SEES'
  },
  {
    mode: 'poldid',
    title: 'Poltide inspektsioon',
    icon: '🔩',
    enabled: true,
    description: 'Assembly Selection VÄLJAS'
  },
  {
    mode: 'muu',
    title: 'Muu inspektsioon',
    icon: '📋',
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'mittevastavus',
    title: 'Mitte vastavus',
    icon: '⚠️',
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'varviparandus',
    title: 'Värviparandused inspektsioon',
    icon: '🎨',
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'keevis',
    title: 'Keeviste inspektsioon',
    icon: '🔥',
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'paigaldatud_detailid',
    title: 'Paigaldatud detailid',
    icon: '📦',
    enabled: false,
    description: 'Arendamisel'
  },
  {
    mode: 'eos2',
    title: 'Saada EOS2 tabelisse',
    icon: '📤',
    enabled: false,
    description: 'Arendamisel'
  }
];

export default function MainMenu({ user, userInitials, onSelectMode, onLogout }: MainMenuProps) {
  return (
    <div className="main-menu-container">
      <div className="main-menu-header">
        <div className="menu-user-info">
          <span className="menu-user-avatar">{userInitials}</span>
          <div className="menu-user-details">
            <span className="menu-user-email">{user.user_email}</span>
            <span className="menu-user-role">{user.role}</span>
          </div>
        </div>
        <button className="menu-logout-btn" onClick={onLogout}>
          Logi välja
        </button>
      </div>

      <div className="main-menu-title">
        <h2>Vali inspektsiooni tüüp</h2>
      </div>

      <div className="main-menu-items">
        {menuItems.map((item) => (
          <button
            key={item.mode}
            className={`menu-item ${item.enabled ? 'enabled' : 'disabled'}`}
            onClick={() => item.enabled && onSelectMode(item.mode)}
            disabled={!item.enabled}
          >
            <span className="menu-item-icon">{item.icon}</span>
            <div className="menu-item-content">
              <span className="menu-item-title">{item.title}</span>
              {item.description && (
                <span className="menu-item-desc">{item.description}</span>
              )}
            </div>
            {item.enabled && <span className="menu-item-arrow">›</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
