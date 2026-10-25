import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, StopCircle, RefreshCw, Trash2, X, AlertCircle, Users, Download, Eye, LogOut } from 'lucide-react';

interface SessionData {
  id: string;
  random_code: string;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expires_at: string;
  ended_at?: string | null;
  created_at?: string | null;
  server_now: string;
}

export default function FacultyPresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Delete Modal State & Attendance records count
  const [attendanceCount, setAttendanceCount] = useState<number>(0);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>('');

  // Store server clock offset: serverTime - clientLocalTime
  const serverOffsetRef = useRef<number>(0);

  const fetchSession = useCallback(async () => {
    if (!id) return;
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Session not found');
        } else if (response.status === 403) {
          throw new Error('Unauthorized to view this session');
        } else {
          throw new Error('Failed to load session');
        }
      }

      const data: SessionData = await response.json();
      setSession(data);
      setError('');

      // Calculate server clock offset
      const serverTimeMs = new Date(data.server_now).getTime();
      const clientTimeMs = Date.now();
      serverOffsetRef.current = serverTimeMs - clientTimeMs;

      return data;
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchAttendanceCount = useCallback(async () => {
    if (!id) return;
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}/attendance`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const rows = await response.json();
        if (Array.isArray(rows)) {
          const count = rows.filter((r: any) => r.status !== null && r.status !== undefined).length;
          setAttendanceCount(count);
        }
      }
    } catch (err) {
      console.error('Error fetching attendance count:', err);
    }
  }, [id]);

  const handleConfirmDelete = async () => {
    if (!id) return;
    setIsDeleting(true);
    setDeleteError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const resJson = await response.json().catch(() => ({}));
        throw new Error(resJson.message || 'Failed to delete session');
      }

      setShowDeleteModal(false);
      navigate('/faculty/dashboard');
    } catch (err: any) {
      console.error('Error deleting session:', err);
      setDeleteError(err.message || 'Error deleting session');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchSession();
    fetchAttendanceCount();
  }, [fetchSession, fetchAttendanceCount]);

  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') {
      setTimeLeft(0);
      return;
    }

    const calculateTimeLeft = () => {
      const estimatedServerNow = Date.now() + serverOffsetRef.current;
      const targetTime = new Date(session.expires_at).getTime();
      const differenceSec = Math.floor((targetTime - estimatedServerNow) / 1000);

      if (differenceSec <= 0) {
        setTimeLeft(0);
        fetchSession(); // Refetch to transition state to EXPIRED on server
      } else {
        setTimeLeft(differenceSec);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [session, fetchSession]);

  const handleEndSession = async () => {
    if (!id) return;
    const confirmEnd = window.confirm('Are you sure you want to end this attendance session?');
    if (!confirmEnd) return;

    setIsEnding(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to end session');
      }

      const data: SessionData = await response.json();
      setSession(data);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Could not end session');
    } finally {
      setIsEnding(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!id) return;
    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}/export`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download Excel file');
      }

      const disposition = response.headers.get('content-disposition');
      let filename = `attendance_${session?.random_code || id}.xlsx`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading Excel:', err);
      alert(err.message || 'Could not download Excel export');
    } finally {
      setDownloading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <RefreshCw className="h-8 w-8 animate-spin text-[#5B4BF0] mb-3" />
        <p className="text-sm font-bold text-[#5B5F8A]">Loading session...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <div className="clay-card p-8 max-w-md w-full">
          <h2 className="text-xl font-extrabold text-[#F43F5E] mb-2">Error</h2>
          <p className="text-sm font-semibold text-[#5B5F8A] mb-6">{error || 'Session not found'}</p>
          <button
            onClick={() => navigate('/faculty/dashboard')}
            className="w-full py-3 px-6 clay-btn clay-btn-primary text-sm font-extrabold rounded-full"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isOver = session.status !== 'ACTIVE';
  const codeChars = (session.random_code || '').slice(0, 6).split('');

  // Total session seconds for progress bar (only if created_at and expires_at exist)
  const totalSeconds = session.created_at && session.expires_at
    ? Math.max(1, Math.round((new Date(session.expires_at).getTime() - new Date(session.created_at).getTime()) / 1000))
    : null;
  const progressPct = !isOver && totalSeconds
    ? Math.max(0, Math.min(100, (timeLeft / totalSeconds) * 100))
    : null;

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-6 lg:p-8">
      {/* Floating Rounded Clay Top Bar */}
      <header className="max-w-7xl w-full mx-auto mb-6">
        <div className="clay-topbar px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full clay-tile flex items-center justify-center font-black text-base text-[#5B4BF0]">
                M
              </div>
              <span className="font-extrabold text-xl text-[#1B1640] tracking-tight">MegaByte</span>
            </div>

            {/* Nav links as clay pills with active state */}
            <nav className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/faculty/dashboard')}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                <ArrowLeft className="h-3 w-3 mr-1" />
                Dashboard
              </button>
              <span className="clay-chip clay-chip-pressed text-xs">
                Code
              </span>
              <button
                type="button"
                onClick={() => navigate(`/session/${session.id}/review`)}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                Live Review
              </button>
              <button
                type="button"
                onClick={() => navigate(`/session/${session.id}/attendance`)}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                Attendance table
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleLogout}
              className="clay-btn clay-btn-secondary px-4 py-2 text-xs rounded-full"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5 text-[#5B5F8A]" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Laptop-first two-column grid at 1024px and up, one column below */}
      <main className="flex-1 max-w-7xl w-full mx-auto flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left card: Attendance Code, 6 raised clay tiles, amber countdown, thin progress bar, status chip */}
          <div className="lg:col-span-7 xl:col-span-8 clay-card p-6 sm:p-10 flex flex-col items-center justify-center text-center">
            {/* Status chip */}
            <div className="mb-4">
              {session.status === 'ACTIVE' ? (
                <span className="clay-chip clay-chip-success">
                  <span className="w-2 h-2 rounded-full bg-[#16A34A] mr-1.5 animate-pulse" />
                  Live
                </span>
              ) : session.status === 'EXPIRED' ? (
                <span className="clay-chip clay-chip-warning">
                  Expired
                </span>
              ) : (
                <span className="clay-chip clay-chip-lavender">
                  Ended
                </span>
              )}
            </div>

            <label className="label-clay block mb-6">
              ATTENDANCE CODE
            </label>

            {/* 6 Code Boxes as raised clay tiles: equal width, monospace, very large, high contrast, readable from back of room */}
            <div className="grid grid-cols-6 gap-2 sm:gap-3 md:gap-4 w-full max-w-xl mx-auto mb-6">
              {codeChars.map((char, index) => (
                <div
                  key={index}
                  className={`aspect-square flex items-center justify-center font-mono font-black text-3xl sm:text-5xl md:text-6xl transition-all ${
                    isOver ? 'clay-tile-code-inactive' : 'clay-tile-code text-[#1B1640]'
                  }`}
                >
                  {char}
                </div>
              ))}
            </div>

            {/* Countdown in amber */}
            {!isOver ? (
              <div className="w-full flex flex-col items-center justify-center space-y-2 mt-2">
                <span className="label-clay block">
                  TIME REMAINING
                </span>
                <div className={`text-5xl sm:text-6xl md:text-7xl font-mono font-black tabular-nums text-[#D97706] ${timeLeft < 60 ? 'animate-pulse text-[#F43F5E]' : ''}`}>
                  {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
                </div>

                {/* Thin progress bar only if total and remaining time already exist */}
                {progressPct !== null && (
                  <div className="w-full max-w-sm h-2 rounded-full bg-slate-200/80 shadow-inner overflow-hidden mt-3">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-[#D97706] rounded-full transition-all duration-1000 ease-linear shadow-sm"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 py-3 px-6 clay-chip clay-chip-lavender text-center">
                <p className="text-sm font-extrabold">Session ended</p>
                <p className="text-[11px] font-semibold opacity-80 mt-0.5">
                  {session.status === 'EXPIRED' ? 'Time limit expired' : 'Ended by faculty'}
                </p>
              </div>
            )}
          </div>

          {/* Right column card: live stat, controls */}
          <div className="lg:col-span-5 xl:col-span-4 clay-card p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200/60">
                <div>
                  <h3 className="text-sm font-extrabold text-[#1B1640] uppercase tracking-wider">Session Overview</h3>
                  <p className="text-xs font-semibold text-[#5B5F8A] mt-0.5">Live attendee statistics & controls</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#34D399] animate-pulse" />
                  <span className="text-xs font-bold text-[#065F46]">Synced</span>
                </div>
              </div>

              {/* Attendance Count Stat */}
              <div className="mt-5 p-4 rounded-2xl clay-card-flat flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl clay-tile flex items-center justify-center text-[#5B4BF0]">
                    <Users className="h-6 w-6" />
                  </div>
                  <div>
                    <span className="label-clay block">
                      Submissions
                    </span>
                    <span className="text-xl font-extrabold text-[#1B1640] font-mono">
                      {attendanceCount} records
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(`/session/${session.id}/review`)}
                className="w-full py-3 px-5 clay-btn clay-btn-secondary text-xs rounded-full"
              >
                <Eye className="h-4 w-4 mr-2 text-[#5B5F8A]" />
                Live Review
              </button>

              <button
                type="button"
                onClick={() => navigate(`/session/${session.id}/attendance`)}
                className="w-full py-3 px-5 clay-btn clay-btn-secondary text-xs rounded-full"
              >
                <Users className="h-4 w-4 mr-2 text-[#5B5F8A]" />
                Attendance table
              </button>

              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={downloading}
                className="w-full py-3 px-5 clay-btn clay-btn-secondary text-xs rounded-full disabled:opacity-50"
              >
                <Download className="h-4 w-4 mr-2 text-[#5B5F8A]" />
                {downloading ? 'Downloading...' : 'Download Excel'}
              </button>

              {/* End Session full-width danger clay-btn */}
              {!isOver && (
                <button
                  type="button"
                  onClick={handleEndSession}
                  disabled={isEnding}
                  className="w-full py-3 px-5 clay-btn clay-btn-danger text-xs rounded-full disabled:opacity-50"
                >
                  <StopCircle className="h-4 w-4 mr-2" />
                  {isEnding ? 'Ending...' : 'End Session'}
                </button>
              )}

              {/* Delete Session quiet danger */}
              <button
                type="button"
                onClick={() => {
                  setDeleteError('');
                  setShowDeleteModal(true);
                }}
                className="w-full py-3 px-5 clay-btn clay-btn-danger-quiet text-xs rounded-full"
                title="Delete Session"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Session
              </button>

              {isOver && (
                <button
                  type="button"
                  onClick={() => navigate('/faculty/dashboard')}
                  className="w-full py-3 px-5 clay-btn clay-btn-primary text-xs rounded-full"
                >
                  Return to Dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="clay-card max-w-md w-full overflow-hidden text-left">
            <div className="flex items-center justify-between p-6 border-b border-slate-200/60">
              <div className="flex items-center gap-2 text-[#F43F5E]">
                <Trash2 className="h-5 w-5" />
                <h3 className="text-base font-extrabold text-[#1B1640]">Delete Session</h3>
              </div>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="p-1.5 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 disabled:opacity-50 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="label-clay block">Session Date</p>
                <p className="font-bold text-[#1B1640] text-sm mt-0.5">
                  {session.created_at
                    ? new Date(session.created_at).toLocaleString()
                    : new Date(session.server_now).toLocaleString()}
                </p>
              </div>

              <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full">
                This permanently deletes {attendanceCount} attendance records and cannot be undone
              </div>

              {deleteError && (
                <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 flex items-center justify-end gap-3 border-t border-slate-200/60">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="px-4 py-2.5 clay-btn clay-btn-secondary text-xs rounded-full disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2.5 clay-btn clay-btn-danger text-xs rounded-full disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  'Delete Session'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
