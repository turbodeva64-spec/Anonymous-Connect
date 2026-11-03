import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Compass,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  Shield,
  Sun,
  UserCheck,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';

function formatRemainingTime(expiresAtIso: string | null): string {
  if (!expiresAtIso) return '24h 00m';
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

interface WorkspaceLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  title,
  subtitle,
  children,
}) => {
  const {
    user,
    sessionExpiresAt,
    theme,
    toggleTheme,
    conversations,
    incomingRequests,
    endCurrentSession,
    toasts,
    dismissToast,
  } = useApp();

  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [remainingTime, setRemainingTime] = useState(() =>
    formatRemainingTime(sessionExpiresAt)
  );

  useEffect(() => {
    setRemainingTime(formatRemainingTime(sessionExpiresAt));
    const interval = setInterval(() => {
      setRemainingTime(formatRemainingTime(sessionExpiresAt));
    }, 30000);
    return () => clearInterval(interval);
  }, [sessionExpiresAt]);

  const pendingIncomingCount = incomingRequests.filter(
    (r) => r.status === 'PENDING'
  ).length;

  const totalUnreadMessages = conversations.reduce(
    (acc, c) => acc + (c.unreadCount || 0),
    0
  );

  const handleEndSession = async () => {
    await endCurrentSession();
    navigate('/');
  };

  const navItems = [
    {
      to: '/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      count: totalUnreadMessages > 0 ? totalUnreadMessages : undefined,
    },
    {
      to: '/discover',
      label: 'User Discovery',
      icon: Compass,
    },
    {
      to: '/requests',
      label: 'Chat Requests',
      icon: Inbox,
      count: pendingIncomingCount > 0 ? pendingIncomingCount : undefined,
    },
    {
      to: '/settings',
      label: 'Settings & Privacy',
      icon: Settings,
    },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start justify-between gap-3 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t.title}
                </p>
                {t.detail && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {t.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(t.id)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/60 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 shrink-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <Link
            to="/dashboard"
            className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
          >
            <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>Anonymous Connect</span>
          </Link>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active Guest Identity Summary */}
        {user && (
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {user.displayName}
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  @{user.username}
                </p>
              </div>
              <Link
                to="/identity"
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
              >
                Identity
              </Link>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-2.5 font-mono tabular-nums">
              <span>{user.isDiscoverable ? 'Discoverable' : 'Hidden'}</span>
              <span aria-hidden="true">·</span>
              <span>Expires in {remainingTime}</span>
            </div>
          </div>
        )}

        {/* Primary Navigation */}
        <nav aria-label="Main navigation" className="px-3 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              location.pathname === item.to ||
              (item.to !== '/dashboard' &&
                location.pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span
                    className={`text-xs font-mono tabular-nums font-semibold ${
                      active
                        ? 'text-indigo-100'
                        : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Direct 1-to-1 Conversations List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Private Conversations ({conversations.length})
            </span>
            <Link
              to="/discover"
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              New Chat
            </Link>
          </div>

          {conversations.length === 0 ? (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No active private chats yet. Accept a request or discover online users.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => {
                const isActive =
                  location.pathname === `/chat/${conv.publicId}`;
                return (
                  <Link
                    key={conv.publicId}
                    to={`/chat/${conv.publicId}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                        : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {conv.peer.displayName}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="text-xs font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                          {conv.unreadCount} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      <span className="font-mono truncate">
                        @{conv.peer.username}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{conv.peer.isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                        {conv.lastMessage.content || 'Shared an attachment'}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar Footer Controls */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
            }
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-4 h-4 text-amber-400" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-slate-600" />
                <span>Dark Mode</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleEndSession}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>End Session</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract (Breadcrumb left + Primary Action right) */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Workspace</span>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-slate-900 dark:text-slate-200 truncate">
                  {title}
                </span>
              </div>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/discover"
              className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Find Users
            </Link>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};
