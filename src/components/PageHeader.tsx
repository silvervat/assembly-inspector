import { useState, useRef, useEffect } from 'react';
import {
  FiArrowLeft, FiMenu, FiTruck, FiCalendar, FiClipboard,
  FiFolder, FiAlertTriangle, FiShield, FiX, FiTool
} from 'react-icons/fi';
import { InspectionMode } from './MainMenu';
import { TrimbleExUser } from '../supabase';

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  currentMode?: InspectionMode;
  user?: TrimbleExUser | null;
  children?: React.ReactNode; // For custom actions in header
}

// Navigation items
interface NavItem {
  mode: InspectionMode | null;
  label: string;
  icon: React.ReactNode;
  color: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { mode: 'installations', label: 'Paigaldamised', icon: <FiTruck size={18} />, color: 'var(--modus-info)' },
  { mode: 'schedule', label: 'Paigaldusgraafik', icon: <FiCalendar size={18} />, color: '#8b5cf6' },
  { mode: 'delivery_schedule', label: 'Tarnegraafik', icon: <FiTruck size={18} />, color: '#059669' },
  { mode: 'arrived_deliveries', label: 'Saabunud tarned', icon: <FiClipboard size={18} />, color: '#0891b2' },
  { mode: 'organizer', label: 'Organiseerija', icon: <FiFolder size={18} />, color: '#7c3aed' },
  { mode: 'issues', label: 'Probleemid', icon: <FiAlertTriangle size={18} />, color: '#dc2626' },
  { mode: 'tools', label: 'Tööriistad', icon: <FiTool size={18} />, color: '#f59e0b' },
  { mode: 'inspection_plan', label: 'Inspektsiooni kava', icon: <FiClipboard size={18} />, color: '#6b7280', adminOnly: true },
  { mode: 'admin', label: 'Administratsioon', icon: <FiShield size={18} />, color: '#6b7280', adminOnly: true },
  { mode: null, label: 'Peamenüü', icon: <FiMenu size={18} />, color: '#6b7280' },
];

export default function PageHeader({
  title,
  onBack,
  onNavigate,
  currentMode,
  user,
  children
}: PageHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Filter nav items based on admin status
  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  const handleNavigate = (mode: InspectionMode | null) => {
    setMenuOpen(false);
    if (onNavigate) {
      onNavigate(mode);
    } else if (mode === null) {
      onBack();
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
              {visibleItems.map((item) => (
                <button
                  key={item.mode || 'main'}
                  className={`dropdown-item ${currentMode === item.mode ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.mode)}
                >
                  <span className="dropdown-icon" style={{ color: item.color }}>
                    {item.icon}
                  </span>
                  <span className="dropdown-label">{item.label}</span>
                </button>
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
