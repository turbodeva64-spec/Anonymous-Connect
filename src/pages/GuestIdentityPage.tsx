import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Eye,
  EyeOff,
  RefreshCw,
  Shield,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';

export const GuestIdentityPage: React.FC = () => {
  const {
    user,
    sessionExpiresAt,
    loadingSession,
    initializeOrRestoreSession,
    updateProfile,
  } = useApp();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [isDiscoverable, setIsDiscoverable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setIsDiscoverable(user.isDiscoverable);
    }
  }, [user]);

  const handleSaveAndContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!user) return;

    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      setErrorMsg('Display name must be between 2 and 32 characters.');
      return;
    }

    setSaving(true);
    try {
      if (
        trimmed !== user.displayName ||
        isDiscoverable !== user.isDiscoverable
      ) {
        await updateProfile({ displayName: trimmed, isDiscoverable });
      }
      navigate('/dashboard');
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not update guest identity.');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateFreshIdentity = async () => {
    setErrorMsg(null);
    setRotating(true);
    try {
      await initializeOrRestoreSession(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not rotate identity.');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="flex items-center justify-between gap-8 px-6 md:px-12 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <Link
          to="/"
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          Anonymous Connect
        </Link>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Enter Dashboard
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8">
          <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Temporary Guest Identity
              </p>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                Your Ephemeral Profile
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Review your automatically generated guest handle or customize
                your display name before entering the workspace.
              </p>
            </div>
            <Shield className="w-6 h-6 text-indigo-600 dark:text-indigo-400 shrink-0" />
          </div>

          {!user ? (
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Provisioning cryptographic guest identity...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveAndContinue} className="mt-6 space-y-6">
              {/* Generated Username & Metadata */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Unique Guest Username
                  </span>
                  <span
                    data-testid="guest-username"
                    className="text-base font-mono font-bold text-indigo-600 dark:text-indigo-400 tabular-nums"
                  >
                    @{user.username}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    Public Identifier
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                    {user.publicId}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Session Expiration</span>
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                    {sessionExpiresAt
                      ? new Date(sessionExpiresAt).toLocaleString()
                      : '24 Hours'}
                  </span>
                </div>
              </div>

              {/* Change Display Name Option */}
              <div>
                <label
                  htmlFor="identity-display-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Custom Display Name
                </label>
                <input
                  id="identity-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                  placeholder="Enter display name (2–32 chars)"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Other users can find you via your permanent session handle{' '}
                  <span className="font-mono">@{user.username}</span> or your
                  display name.
                </p>
              </div>

              {/* Discoverability Toggle */}
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                    {isDiscoverable ? (
                      <Eye className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-amber-500" />
                    )}
                    <span>
                      {isDiscoverable
                        ? 'Discoverable in User Directory'
                        : 'Hidden from Public Discovery'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Control whether other guests can find your username and send
                    chat requests.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDiscoverable}
                  aria-label="Toggle discoverability"
                  onClick={() => setIsDiscoverable((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isDiscoverable
                      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {isDiscoverable ? 'Enabled' : 'Hidden'}
                </button>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300"
                >
                  {errorMsg}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleGenerateFreshIdentity}
                  disabled={rotating || saving}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`}
                  />
                  <span>Rotate Guest Identity</span>
                </button>

                <button
                  type="submit"
                  disabled={saving || rotating}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Enter Dashboard'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
