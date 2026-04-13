'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  FilePlus,
  Clock,
  BookOpen,
  Users,
  Settings,
  LogOut,
} from 'lucide-react';

interface SidebarProps {
  user: {
    name: string;
    role: string;
    email: string;
  };
}

const navItems = [
  { name: 'Dashboard',    href: '/dashboard', icon: LayoutDashboard },
  { name: 'New Proposal', href: '/generate',  icon: FilePlus },
  { name: 'History',      href: '/history',   icon: Clock },
];

const adminItems = [
  { name: 'Knowledge Base',   href: '/admin/knowledge-base', icon: BookOpen },
  { name: 'User Management',  href: '/admin/users',          icon: Users },
  { name: 'Settings',         href: '/admin/settings',       icon: Settings },
];

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  };

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src="/Logo.png" alt="Gravity One" className="sidebar-logo-img" />
        </div>
        <div>
          <div className="sidebar-brand">gravity<span style={{ fontWeight: 300 }}>one</span></div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '1px' }}>Proposal AI Studio</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">General</div>
        {navItems.map(({ name, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-link ${pathname === href ? 'active' : ''}`}
          >
            <span className="nav-icon"><Icon size={16} strokeWidth={2} /></span>
            {name}
          </Link>
        ))}

        {user.role === 'admin' && (
          <>
            <div className="sidebar-divider" />
            <div className="nav-section-label">Admin</div>
            {adminItems.map(({ name, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link ${pathname === href ? 'active' : ''}`}
              >
                <span className="nav-icon"><Icon size={16} strokeWidth={2} /></span>
                {name}
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="user-badge">
          <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
          <button
            className="logout-btn"
            onClick={handleLogout}
            title="Sign out"
            disabled={isLoggingOut}
          >
            <LogOut size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}
