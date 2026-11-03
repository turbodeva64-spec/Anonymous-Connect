import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  Ban,
  Clock,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Shield,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { api } from '../services/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { WorkspaceLayout } from '../components/WorkspaceLayout.tsx';
import type { SecurityAuditSummary } from '../types/index.ts';

export const SettingsPrivacyPage: React.FC = () => {
  const {
    user,
    sessionExpiresAt,
    loadingSession,
    initializeOrRestoreSession,
    updateProfile,
    blockedUsers,
    blockUser,
    unblockUser,
    endCurrentSession,
    addToast,
  } = useApp();

  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [blockTarget, setBlockTarget] = useState('');
  const [blockReason, setBlockReason] = useState('');

  const [reportTarget, setReportTarget] = useState('');
  const [reportCategory, setReportCategory] = useState<
    'harassment' | 'spam' | 'malicious_file' | 'impersonation' | 'other'
  >('harassment');
  const [reportDesc, setReportDesc] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Admin Firebase Auth state for Administrative Security Operations
  const [adminUser, setAdminUser] = useState<FirebaseUser | null>(null);
  const [auditData, setAuditData] = useState<SecurityAuditSummary | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
    }
  }, [user]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      setAdminUser(u);
      if (u) {
        setLoadingAudit(true);
        try {
          const token = await u.getIdToken();
          const res = await api.getAdminSecurityAudit(token);
          setAuditData(res.audit);
        } catch (err: any) {
          addToast('error', 'Admin Verification Error', err.message);
        } finally {
          setLoadingAudit(false);
        }
      } else {
        setAuditData(null);
      }
    });
    return () => unsub();
  }, [addToast]);

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = displayName.trim();
    if (cleaned.length < 2 || cleaned.length > 32) {
      addToast(
        'error',
        'Validation Error',
        'Display name must be between 2 and 32 characters.'
      );
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ displayName: cleaned });
    } catch (err: any) {
      addToast('error', 'Update Failed', err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedTarget = blockTarget.trim().replace(/^@/, '');
    if (!cleanedTarget) {
      addToast(
        'error',
        'Validation Error',
        'Please enter a valid guest username to block.'
      );
      return;
    }
    try {
      await blockUser(cleanedTarget, blockReason.trim());
      setBlockTarget('');
      setBlockReason('');
    } catch {
      // Error toast is already displayed by blockUser in AppContext
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedTarget = reportTarget.trim().replace(/^@/, '');
    if (!cleanedTarget) {
      addToast(
        'error',
        'Validation Error',
        'Please enter the username you wish to report.'
      );
      return;
    }
    if (reportDesc.trim().length < 5) {
      addToast(
        'error',
        'Validation Error',
        'Incident description must be at least 5 characters.'
      );
      return;
    }
    setSubmittingReport(true);
    try {
      await api.submitReport({
        reportedUser: cleanedTarget,
        category: reportCategory,
        description: reportDesc.trim(),
      });
      addToast(
        'success',
        'User Report Logged',
        'Your safety report has been stored in PostgreSQL.'
      );
      setReportTarget('');
      setReportDesc('');
    } catch (err: any) {
      addToast('error', 'Report Failed', err.message);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleEndSession = async () => {
    await endCurrentSession();
    navigate('/');
  };

  const handleAdminSignIn = async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      addToast(
        'error',
        'Administrator Sign-In Cancelled',
        err.message || 'Could not authenticate administrator.'
      );
    }
  };

  const handleAdminSignOut = async () => {
    await signOut(auth);
    setAuditData(null);
  };

  return (
    <WorkspaceLayout
      title="Settings & Privacy"
      subtitle="Manage your temporary guest identity, discoverability, blocked users, session lifecycle, and safety reports"
    >
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {/* 1. Identity & Discoverability Controls */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Temporary Identity & Discoverability
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Update how your guest profile appears to other users in the
              directory.
            </p>
          </div>

          <form
            onSubmit={handleSaveDisplayName}
            className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Permanent Session Username
              </label>
              <input
                type="text"
                disabled
                value={user ? `@${user.username}` : ''}
                className="w-full px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-500"
              />
            </div>

            <div className="md:col-span-5">
              <label
                htmlFor="settings-display-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Display Name
              </label>
              <input
                id="settings-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={32}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : 'Save Display Name'}
              </button>
            </div>
          </form>

          {/* Discoverability Row */}
          {user && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 border-t border-slate-200 dark:border-slate-800">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  {user.isDiscoverable ? (
                    <Eye className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-amber-500" />
                  )}
                  <span>
                    Directory Discoverability:{' '}
                    {user.isDiscoverable ? 'Enabled' : 'Hidden'}
                  </span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  When disabled, your username will not appear in search results
                  or the online users list, and new chat requests will be
                  blocked.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateProfile({ isDiscoverable: !user.isDiscoverable })
                }
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                {user.isDiscoverable
                  ? 'Disable Discoverability'
                  : 'Enable Discoverability'}
              </button>
            </div>
          )}
        </section>

        {/* 2. Blocked Users & User Reporting Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Blocked Users Management */}
          <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Ban className="w-4 h-4 text-rose-500" />
                <span>Manage Blocked Users ({blockedUsers.length})</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Blocked users cannot discover you, send requests, or exchange
                messages with you.
              </p>
            </div>

            <form onSubmit={handleBlockSubmit} className="flex gap-2">
              <input
                type="text"
                value={blockTarget}
                onChange={(e) => setBlockTarget(e.target.value)}
                aria-label="Username to block"
                placeholder="Enter username (e.g. Guest_51902)..."
                className="flex-1 px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 rounded-lg whitespace-nowrap"
              >
                Block User
              </button>
            </form>

            {blockedUsers.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                You have not blocked any users.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {blockedUsers.map((b) => (
                  <div
                    key={b.publicId}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {b.displayName}{' '}
                        <span className="text-xs font-mono text-slate-500">
                          (@{b.username})
                        </span>
                      </p>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        Blocked {new Date(b.blockedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => unblockUser(b.username)}
                      className="px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Report a User */}
          <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Report a User</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Submit a safety or abuse report against a guest username.
              </p>
            </div>

            <form onSubmit={handleReportSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="settings-report-user"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Target Username
                </label>
                <input
                  id="settings-report-user"
                  type="text"
                  required
                  value={reportTarget}
                  onChange={(e) => setReportTarget(e.target.value)}
                  placeholder="e.g. Guest_84291"
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-report-cat"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Reason
                </label>
                <select
                  id="settings-report-cat"
                  value={reportCategory}
                  onChange={(e) =>
                    setReportCategory(e.target.value as typeof reportCategory)
                  }
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="harassment">Harassment or Abuse</option>
                  <option value="spam">Spam or Flooding</option>
                  <option value="malicious_file">Suspicious Attachment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="settings-report-desc"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Incident Description
                </label>
                <textarea
                  id="settings-report-desc"
                  rows={2}
                  required
                  minLength={5}
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="Provide details (minimum 5 characters)..."
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={submittingReport}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {submittingReport ? 'Submitting...' : 'Submit Safety Report'}
              </button>
            </form>
          </section>
        </div>

        {/* 3. Session Lifecycle & Privacy Disclosure */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span>Session Expiration & Termination</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                Active session expires:{' '}
                {sessionExpiresAt
                  ? new Date(sessionExpiresAt).toLocaleString()
                  : '24 hours from creation'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleEndSession}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              <LogOut className="w-4 h-4" />
              <span>End Guest Session Now</span>
            </button>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 leading-relaxed space-y-2">
            <p>
              <strong className="text-slate-900 dark:text-slate-200">
                Privacy & Retention Policy:
              </strong>{' '}
              Your guest session is authenticated via an HTTP-Only cookie whose
              raw token is hashed with SHA-256 in PostgreSQL. Clearing your
              cookies, opening a different browser, or clicking “End Guest
              Session Now” revokes your session and prevents access to previous
              conversations.
            </p>
          </div>
        </section>

        {/* 4. Protected Administrative Security Operations (Firebase Auth RBAC) */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Administrator Security & Moderation Audit</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Protected server-side route (/api/admin/audit). Requires
                verified administrator sign-in; ordinary guests never need to
                sign in.
              </p>
            </div>

            {adminUser ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-500">
                  {adminUser.email}
                </span>
                <button
                  type="button"
                  onClick={handleAdminSignOut}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Sign Out Admin
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAdminSignIn}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap self-start sm:self-auto"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Verify Administrator (Google OAuth)</span>
              </button>
            )}
          </div>

          {loadingAudit && (
            <p className="text-xs text-slate-500">
              Verifying Firebase ID Token and loading security audit...
            </p>
          )}

          {auditData && (
            <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-slate-500 block">Active Guests</span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {auditData.activeGuestsCount}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Valid Sessions</span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {auditData.activeSessionsCount}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">1-to-1 Chats</span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {auditData.activeConversationsCount}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Stored Messages</span>
                  <strong className="text-base text-slate-900 dark:text-white">
                    {auditData.totalMessagesCount}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Open Reports</span>
                  <strong className="text-base text-rose-600 dark:text-rose-400">
                    {auditData.openReportsCount}
                  </strong>
                </div>
              </div>

              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {auditData.securityControls.map((ctrl) => (
                  <div
                    key={ctrl.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ctrl.area}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 ml-2">
                        — {ctrl.detail}
                      </span>
                    </div>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
                      {ctrl.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </WorkspaceLayout>
  );
};
