import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, X, ArrowLeft, RefreshCw, Download, Users, LogOut } from 'lucide-react';

interface PendingSubmission {
  record_id: string;
  name: string;
  student_id: string;
  photo_base64: string;
  status: string;
  face_match_score?: number | null;
  liveness_score?: number | null;
}

interface SessionInfo {
  id: string;
  random_code: string;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expires_at: string;
  ended_at?: string | null;
  server_now: string;
}

export default function FacultyReview() {
  const { id } = useParams<{ id: string }>();
  const currentSessionId = id;
  const navigate = useNavigate();

  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  const serverOffsetRef = useRef<number>(0);

  const fetchSession = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${currentSessionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data: SessionInfo = await response.json();
        setSessionInfo(data);
        const serverTime = new Date(data.server_now).getTime();
        serverOffsetRef.current = serverTime - Date.now();
      }
    } catch (err) {
      console.error('Error fetching session info:', err);
    }
  }, [currentSessionId]);

  const fetchPending = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/attendance/session/${currentSessionId}/pending`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch submissions');
      }
      
      const data = await response.json();
      setSubmissions(data);
      setError('');
    } catch (err: any) {
      console.error(err);
      setError('Connection error while fetching submissions');
    } finally {
      setLoading(false);
    }
  }, [currentSessionId]);

  useEffect(() => {
    fetchSession();
    fetchPending();
  }, [fetchSession, fetchPending]);

  // Stop polling when status != ACTIVE
  useEffect(() => {
    if (!sessionInfo || sessionInfo.status !== 'ACTIVE') {
      return;
    }

    const interval = setInterval(() => {
      fetchSession();
      fetchPending();
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionInfo?.status, fetchSession, fetchPending]);

  // Tick every second to update active countdown display
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleDownloadExcel = async () => {
    if (!currentSessionId) return;
    setDownloading(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${currentSessionId}/export`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download Excel file');
      }

      const disposition = response.headers.get('content-disposition');
      let filename = `attendance_${sessionInfo?.random_code || currentSessionId}.xlsx`;
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

  const handleReview = async (recordId: string, status: 'APPROVED' | 'REJECTED') => {
    // Optimistic UI update
    setSubmissions(prev => prev.filter(sub => sub.record_id !== recordId));
    
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/attendance/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ record_id: recordId, status })
      });

      if (!response.ok) {
        fetchPending();
      }
    } catch (err) {
      console.error('Error reviewing submission:', err);
      fetchPending();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const renderStatusChip = () => {
    if (!sessionInfo) return null;
    if (sessionInfo.status === 'ACTIVE') {
      const estimatedServerNow = Date.now() + serverOffsetRef.current;
      const remainingSec = Math.max(0, Math.floor((new Date(sessionInfo.expires_at).getTime() - estimatedServerNow) / 1000));
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      return (
        <span className="clay-chip clay-chip-success">
          <span className="w-2 h-2 rounded-full bg-[#16A34A] mr-1.5 animate-pulse" />
          ACTIVE • {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
        </span>
      );
    }
    if (sessionInfo.status === 'EXPIRED') {
      return (
        <span className="clay-chip clay-chip-warning">
          Expired
        </span>
      );
    }
    return (
      <span className="clay-chip clay-chip-lavender">
        Ended
      </span>
    );
  };

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
              <button
                type="button"
                onClick={() => navigate(`/session/${currentSessionId}`)}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                Code
              </button>
              <span className="clay-chip clay-chip-pressed text-xs">
                Live Review
              </span>
              <button
                type="button"
                onClick={() => navigate(`/session/${currentSessionId}/attendance`)}
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

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto space-y-6">
        {/* Page Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 clay-card p-4 sm:p-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">Live Review Dashboard</h1>
              {renderStatusChip()}
            </div>
            <p className="text-xs font-semibold text-[#5B5F8A] mt-1">Real-time student face match verification</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate(`/session/${currentSessionId}/attendance`)}
              className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs rounded-full"
              title="View and Edit Attendance Roster"
            >
              <Users className="h-3.5 w-3.5 mr-1.5 text-[#5B5F8A]" />
              Attendance Roster
            </button>
            <button
              onClick={handleDownloadExcel}
              disabled={downloading}
              className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs rounded-full disabled:opacity-50"
              title="Download Attendance Excel Workbook"
            >
              <Download className="h-3.5 w-3.5 mr-1.5 text-[#5B5F8A]" />
              {downloading ? 'Downloading...' : 'Download Excel'}
            </button>
            {sessionInfo?.status === 'ACTIVE' ? (
              <div className="clay-chip clay-chip-success">
                <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                Live Polling Active
              </div>
            ) : (
              <div className="clay-chip clay-chip-lavender">
                Session ended
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full">
            {error}
          </div>
        )}

        {loading && submissions.length === 0 ? (
          <div className="flex justify-center items-center py-24 clay-card">
            <RefreshCw className="h-8 w-8 animate-spin text-[#5B4BF0] mr-2" />
            <span className="text-sm font-bold text-[#5B5F8A]">Loading submissions...</span>
          </div>
        ) : submissions.length === 0 ? (
          <div className="clay-card p-12 text-center text-[#5B5F8A]">
            <div className="mx-auto w-16 h-16 mb-4 rounded-full clay-tile flex items-center justify-center text-[#34D399]">
              <Check className="h-8 w-8" />
            </div>
            {sessionInfo?.status !== 'ACTIVE' ? (
              <h3 className="text-lg font-extrabold text-[#1B1640]">No pending submissions</h3>
            ) : (
              <>
                <h3 className="text-lg font-extrabold text-[#1B1640]">All caught up!</h3>
                <p className="text-xs font-semibold text-[#5B5F8A] mt-1">Waiting for new student submissions...</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {submissions.map((sub) => (
              <div key={sub.record_id} className="clay-card p-4 overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 relative mb-3 shadow-inner border border-white/60">
                    {sub.photo_base64 ? (
                      <img 
                        src={sub.photo_base64} 
                        alt={`Photo of ${sub.name}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-400">
                        No Photo
                      </div>
                    )}
                    {sub.face_match_score !== undefined && sub.face_match_score !== null && (
                      <div className="absolute top-2.5 right-2.5 clay-chip clay-chip-pressed text-[10px]">
                        <span>Match {Math.round(sub.face_match_score * 100)}%</span>
                        {sub.liveness_score !== undefined && sub.liveness_score !== null && (
                          <span className="text-emerald-300 ml-1">• Live {Math.round(sub.liveness_score * 100)}%</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-sm text-[#1B1640] truncate">{sub.name}</h3>
                        <p className="text-xs font-mono font-semibold text-[#5B5F8A] truncate mt-0.5">{sub.student_id || 'No ID'}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {sub.face_match_score !== undefined && sub.face_match_score !== null && (
                          <span className="clay-chip clay-chip-pressed text-[10px]">
                            {Math.round(sub.face_match_score * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => handleReview(sub.record_id, 'REJECTED')}
                    className="clay-btn clay-btn-danger-quiet py-2.5 px-3 text-xs rounded-full"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(sub.record_id, 'APPROVED')}
                    className="clay-btn clay-btn-success py-2.5 px-3 text-xs rounded-full"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
