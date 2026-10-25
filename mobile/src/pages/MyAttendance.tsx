import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  LogOut,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  ArrowLeft,
  Plus,
  X,
  CheckCircle2,
} from 'lucide-react';
import BottomNav from '../components/BottomNav';

interface SessionItem {
  session_id: string;
  date: string;
  status: 'Present' | 'Rejected' | 'Pending' | 'Absent';
  edited: boolean;
  edit_reason?: string | null;
}

interface SubjectAttendance {
  subject_id: string;
  subject_name: string;
  subject_code: string;
  total: number;
  present: number;
  percentage: number;
  sessions: SessionItem[];
}

interface SheetRow {
  student_id: string;
  name: string;
  cells: string[];
  present: number;
  total: number;
  percentage: number;
}

interface SheetViewData {
  sessions: string[];
  rows: SheetRow[];
  updated_at: string;
}

export default function MyAttendance() {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<SubjectAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  // Master Sheet View State
  const [selectedSubjectForSheet, setSelectedSubjectForSheet] = useState<SubjectAttendance | null>(null);
  const [sheetData, setSheetData] = useState<SheetViewData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState('');

  // Add Subject Modal State
  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false);
  const [publicSubjects, setPublicSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [loadingPublicSubjects, setLoadingPublicSubjects] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enrollSuccess, setEnrollSuccess] = useState('');
  const [enrollError, setEnrollError] = useState('');

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/attendance/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          navigate('/login');
          return;
        }
        throw new Error('Failed to load attendance history');
      }

      const data: SubjectAttendance[] = await response.json();
      setSubjects(data);
      setError('');

      // Auto-expand all subjects by default for clear visibility
      const expanded: Record<string, boolean> = {};
      data.forEach((sub) => {
        expanded[sub.subject_id] = true;
      });
      setExpandedSubjects(expanded);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading attendance');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const openAddSubjectModal = async () => {
    setShowAddSubjectModal(true);
    setSelectedSubjectId('');
    setEnrollSuccess('');
    setEnrollError('');
    setLoadingPublicSubjects(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects/public`);
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }
      if (!res.ok || !Array.isArray(data)) {
        throw new Error('Could not load subjects, try again');
      }
      setPublicSubjects(data);
    } catch (err: any) {
      setEnrollError(err.message || 'Could not load subjects, try again');
    } finally {
      setLoadingPublicSubjects(false);
    }
  };

  const closeAddSubjectModal = () => {
    if (enrolling) return;
    setShowAddSubjectModal(false);
    setSelectedSubjectId('');
    setEnrollSuccess('');
    setEnrollError('');
  };

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId) {
      setEnrollError('Please select a subject to enroll.');
      return;
    }

    setEnrolling(true);
    setEnrollError('');
    setEnrollSuccess('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subjectId: selectedSubjectId }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!res.ok) {
        throw new Error(data?.message || 'Failed to enroll in subject');
      }

      setEnrollSuccess('Successfully enrolled!');
      // Refresh page data after enrolling
      await fetchAttendance();

      setTimeout(() => {
        setShowAddSubjectModal(false);
        setEnrollSuccess('');
        setSelectedSubjectId('');
      }, 1000);
    } catch (err: any) {
      setEnrollError(err.message || 'Failed to enroll in subject');
    } finally {
      setEnrolling(false);
    }
  };

  useEffect(() => {
    fetchAttendance();

    const handleFocus = () => {
      fetchAttendance();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAttendance();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchAttendance]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const toggleSubject = (subjectId: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [subjectId]: !prev[subjectId],
    }));
  };

  const openSheetView = async (sub: SubjectAttendance) => {
    setSelectedSubjectForSheet(sub);
    setSheetData(null);
    setSheetError('');
    setSheetLoading(true);

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects/${sub.subject_id}/sheet/view`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (errJson.error === 'NO_SHEET') {
          setSheetError("Your faculty hasn't set up the sheet yet");
        } else {
          setSheetError(errJson.message || 'Failed to load sheet');
        }
        return;
      }

      const data: SheetViewData = await res.json();
      setSheetData(data);
    } catch (err: any) {
      console.error('Error fetching sheet view:', err);
      setSheetError(err.message || 'Error loading sheet');
    } finally {
      setSheetLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const renderStatusBadge = (status: SessionItem['status']) => {
    switch (status) {
      case 'Present':
        return (
          <span className="clay-chip clay-chip-success">
            Present
          </span>
        );
      case 'Rejected':
        return (
          <span className="clay-chip clay-chip-danger">
            Rejected
          </span>
        );
      case 'Pending':
        return (
          <span className="clay-chip clay-chip-warning">
            Pending
          </span>
        );
      case 'Absent':
      default:
        return (
          <span className="clay-chip clay-chip-neutral">
            Absent
          </span>
        );
    }
  };

  // Sheet View Sub-screen
  if (selectedSubjectForSheet) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col justify-between safe-pt pb-28">
        <div className="w-full max-w-[360px] sm:max-w-xl mx-auto px-4 py-4 space-y-4">
          {/* Header Bar */}
          <div className="flex items-center justify-between clay-topbar px-4 py-2.5">
            <button
              type="button"
              onClick={() => setSelectedSubjectForSheet(null)}
              className="flex items-center gap-1.5 min-h-[44px] px-3 clay-btn clay-btn-secondary text-xs rounded-full"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
            <div className="text-right">
              <span className="clay-chip clay-chip-pressed text-[10px]">
                {selectedSubjectForSheet.subject_code}
              </span>
              <h2 className="text-xs font-extrabold text-[#1B1640] truncate max-w-[180px] mt-0.5">
                {selectedSubjectForSheet.subject_name}
              </h2>
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <h1 className="text-lg font-extrabold text-[#1B1640]">Master Sheet</h1>
            {sheetData?.updated_at && (
              <span className="text-[11px] text-[#5B6190] font-mono font-semibold">
                Updated: {new Date(sheetData.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {sheetLoading ? (
            <div className="clay-card p-10 text-center text-[#5B6190] space-y-3">
              <RefreshCw className="h-7 w-7 animate-spin text-[#5B4BF0] mx-auto" />
              <p className="text-xs font-bold">Loading master sheet...</p>
            </div>
          ) : sheetError ? (
            <div className="clay-card p-7 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl clay-tile text-[#D97706] flex items-center justify-center mx-auto">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-extrabold text-[#1B1640]">
                {sheetError}
              </h3>
              <p className="text-xs font-semibold text-[#5B6190] max-w-xs mx-auto">
                The master attendance sheet has not been published by your faculty yet.
              </p>
              <button
                type="button"
                onClick={() => setSelectedSubjectForSheet(null)}
                className="w-full h-11 min-h-[44px] clay-btn clay-btn-secondary text-xs font-bold rounded-full"
              >
                Return to Records
              </button>
            </div>
          ) : sheetData && sheetData.rows.length > 0 ? (
            <div className="clay-card overflow-hidden">
              <div className="overflow-x-auto max-w-full">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead className="bg-[#F4F6FD] sticky top-0 z-20">
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 bg-[#F4F6FD] z-30 px-3 py-3 label-clay border-b border-r border-slate-200 min-w-[85px] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.04)]"
                      >
                        Student ID
                      </th>
                      <th
                        scope="col"
                        className="sticky left-[85px] bg-[#F4F6FD] z-30 px-3 py-3 label-clay border-b border-r border-slate-200 min-w-[110px] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.04)]"
                      >
                        Name
                      </th>
                      {sheetData.sessions.map((sessHeader, idx) => (
                        <th
                          key={idx}
                          scope="col"
                          className="px-3 py-2.5 text-center text-[11px] font-extrabold text-[#1B1640] border-b border-r border-slate-200 min-w-[105px]"
                        >
                          <div className="font-extrabold text-[#1B1640] text-[11px] whitespace-nowrap">{sessHeader}</div>
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="px-3 py-3 text-center label-clay border-b border-slate-200 min-w-[60px]"
                      >
                        Present
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3 text-center label-clay border-b border-slate-200 min-w-[55px]"
                      >
                        Total
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3 text-center label-clay border-b border-slate-200 min-w-[55px]"
                      >
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white/40 divide-y divide-slate-100">
                    {sheetData.rows.map((row) => (
                      <tr key={row.student_id} className="hover:bg-white/60">
                        <td className="sticky left-0 bg-[#FBFBFF] z-10 px-3 py-3 text-xs font-mono font-bold text-[#1B1640] border-r border-slate-200 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.04)]">
                          {row.student_id}
                        </td>
                        <td className="sticky left-[85px] bg-[#FBFBFF] z-10 px-3 py-3 text-xs font-bold text-[#1B1640] border-r border-slate-200 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.04)] whitespace-nowrap">
                          {row.name}
                        </td>
                        {row.cells.map((cellText, cellIdx) => {
                          let badge = 'bg-slate-100 text-[#5B6190] border-slate-300';
                          if (cellText === 'P') {
                            badge = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                          } else if (cellText === 'A') {
                            badge = 'bg-rose-100 text-rose-800 border-rose-300';
                          } else if (cellText === 'R') {
                            badge = 'bg-rose-100 text-rose-800 border-rose-300';
                          } else if (cellText === 'PEND') {
                            badge = 'bg-amber-100 text-amber-800 border-amber-300';
                          }
                          return (
                            <td key={cellIdx} className="px-3 py-2 text-center text-xs border-r border-slate-100">
                              <span className={`inline-block px-2 py-0.5 rounded-md font-bold text-[11px] border ${badge}`}>
                                {cellText}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-center text-xs font-extrabold text-[#065F46] font-mono">
                          {row.present}
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-[#5B6190] font-bold font-mono">
                          {row.total}
                        </td>
                        <td className="px-3 py-3 text-center text-xs font-black font-mono text-[#1B1640]">
                          {row.percentage}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="clay-card p-8 text-center text-[#5B6190]">
              <p className="text-xs font-semibold">No session records found.</p>
            </div>
          )}
        </div>

        {/* Bottom Nav */}
        <BottomNav activeTab="records" />
      </div>
    );
  }

  // Main Records Screen
  return (
    <div className="min-h-screen bg-transparent flex flex-col justify-between safe-pt pb-28">
      <div className="w-full max-w-[360px] sm:max-w-md mx-auto px-4 py-4 space-y-4">
        {/* Top Header */}
        <header className="flex items-center justify-between clay-topbar px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl clay-tile text-[#5B4BF0] font-black text-sm flex items-center justify-center select-none shadow-xs">
              M
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#1B1640] leading-tight">MegaByte</h2>
              <span className="text-[10px] uppercase tracking-wider text-[#5B6190] font-extrabold">Student Portal</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={fetchAttendance}
              disabled={loading}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] text-[#5B6190] hover:text-[#5B4BF0] transition-colors disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh attendance"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-[#5B4BF0]' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] text-[#5B6190] hover:text-[#F43F5E] transition-colors"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Page Title & Profile */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h1 className="text-xl font-extrabold text-[#1B1640] tracking-tight">My Records</h1>
            {user.name && (
              <p className="text-xs font-semibold text-[#5B6190] mt-0.5">
                {user.name} <span className="font-mono text-[#5B6190]">({user.student_id})</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openAddSubjectModal}
            className="flex items-center gap-1.5 px-3.5 py-2 clay-btn clay-btn-primary text-xs font-extrabold rounded-full"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add subject</span>
          </button>
        </div>

        {error && (
          <div className="clay-chip-danger px-3.5 py-2.5 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Subjects List */}
        {loading && subjects.length === 0 ? (
          <div className="clay-card p-10 text-center text-[#5B6190] space-y-3">
            <RefreshCw className="h-7 w-7 animate-spin text-[#5B4BF0] mx-auto" />
            <p className="text-xs font-bold">Loading your attendance records...</p>
          </div>
        ) : subjects.length === 0 ? (
          <div className="clay-card p-8 text-center text-[#5B6190] space-y-3">
            <CalendarCheck className="h-10 w-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-extrabold text-[#1B1640]">No enrolled subjects</h3>
            <p className="text-xs font-semibold text-[#5B6190]">You are not currently enrolled in any subjects.</p>
            <button
              type="button"
              onClick={openAddSubjectModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 clay-btn clay-btn-primary text-xs font-extrabold rounded-full mx-auto"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add subject</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {subjects.map((sub) => {
              const isExpanded = expandedSubjects[sub.subject_id] ?? true;

              return (
                <div
                  key={sub.subject_id}
                  className="clay-card overflow-hidden transition-all"
                >
                  {/* Subject Header */}
                  <div
                    onClick={() => toggleSubject(sub.subject_id)}
                    className="p-4 cursor-pointer hover:bg-white/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="clay-chip clay-chip-pressed text-[10px]">
                          {sub.subject_code}
                        </span>
                        <h3 className="font-extrabold text-[#1B1640] text-sm mt-1 truncate">
                          {sub.subject_name}
                        </h3>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-sm font-black text-[#1B1640] font-mono">
                          {sub.present}/{sub.total} ({sub.percentage}%)
                        </span>
                        <div className="mt-1 flex justify-end">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-[#5B6190]" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-[#5B6190]" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-[#E8EEFB] rounded-full h-2.5 mt-3 overflow-hidden shadow-inner">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-500 ${
                          sub.percentage >= 75
                            ? 'bg-gradient-to-r from-emerald-400 to-[#34D399]'
                            : sub.percentage >= 50
                            ? 'bg-gradient-to-r from-amber-400 to-[#FBBF24]'
                            : 'bg-gradient-to-r from-rose-400 to-[#F43F5E]'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, sub.percentage))}%` }}
                      />
                    </div>

                    {/* View Sheet Button */}
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSheetView(sub);
                        }}
                        className="w-full h-11 min-h-[44px] flex items-center justify-center gap-2 clay-btn clay-btn-secondary text-xs font-extrabold rounded-full"
                      >
                        <FileSpreadsheet className="h-4 w-4 text-[#34D399]" />
                        <span>View sheet</span>
                      </button>
                    </div>
                  </div>

                  {/* Expandable Sessions List */}
                  {isExpanded && (
                    <div className="border-t border-slate-200/60 bg-white/30 p-3.5 space-y-2">
                      {sub.sessions.length === 0 ? (
                        <p className="text-xs text-[#5B6190] font-semibold text-center py-2">
                          No completed sessions for this subject yet.
                        </p>
                      ) : (
                        sub.sessions.map((sess) => (
                          <div
                            key={sess.session_id}
                            className="bg-[#FBFAFF] p-3 rounded-2xl border border-[rgba(140,120,230,0.18)] flex flex-col gap-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#1B1640]">
                                {formatDate(sess.date)}
                              </span>
                              {renderStatusBadge(sess.status)}
                            </div>

                            {/* Show 'Edited by faculty' + reason if edited */}
                            {sess.edited && (
                              <div className="mt-1 pt-1.5 border-t border-slate-200/60 flex flex-col gap-1 text-xs">
                                <span className="clay-chip clay-chip-warning text-[10px] w-fit">
                                  Edited by faculty
                                </span>
                                {sess.edit_reason && (
                                  <p className="text-[#5B6190] italic text-[11px] font-semibold">
                                    "{sess.edit_reason}"
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Subject Modal */}
      {showAddSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-[360px] clay-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-[#1B1640]">Add Subject</h3>
                <p className="text-[11px] font-semibold text-[#5B6190]">Enroll in another subject</p>
              </div>
              <button
                type="button"
                onClick={closeAddSubjectModal}
                disabled={enrolling}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {enrollSuccess && (
              <div className="clay-chip-success px-3.5 py-2.5 rounded-2xl text-xs font-bold w-full flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span>{enrollSuccess}</span>
              </div>
            )}

            {enrollError && (
              <div className="clay-chip-danger px-3.5 py-2.5 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{enrollError}</span>
              </div>
            )}

            <form onSubmit={handleEnrollSubmit} className="space-y-4">
              <div>
                <label className="label-clay block mb-1.5">
                  Available Subjects
                </label>
                {loadingPublicSubjects ? (
                  <div className="h-11 flex items-center justify-center border border-[rgba(140,120,230,0.18)] rounded-xl bg-[#F1F4FD] text-xs text-[#5B6190] font-bold">
                    <RefreshCw className="h-4 w-4 animate-spin text-[#5B4BF0] mr-2" />
                    Loading subjects...
                  </div>
                ) : (
                  (() => {
                    const availableSubjects = publicSubjects.filter(
                      (ps) => !subjects.some((s) => s.subject_id === ps.id)
                    );

                    if (availableSubjects.length === 0) {
                      return (
                        <div className="p-3 border border-[rgba(140,120,230,0.18)] rounded-xl bg-[#F1F4FD] text-xs text-[#5B6190] font-semibold text-center">
                          You are already enrolled in all available subjects.
                        </div>
                      );
                    }

                    return (
                      <select
                        required
                        value={selectedSubjectId}
                        onChange={(e) => setSelectedSubjectId(e.target.value)}
                        disabled={enrolling}
                        className="w-full h-11 px-3.5 clay-input text-sm disabled:opacity-50"
                      >
                        <option value="" disabled>
                          Select a subject
                        </option>
                        {availableSubjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.code} - {sub.name}
                          </option>
                        ))}
                      </select>
                    );
                  })()
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeAddSubjectModal}
                  disabled={enrolling}
                  className="flex-1 h-11 clay-btn clay-btn-secondary text-xs font-bold rounded-full disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    enrolling ||
                    !selectedSubjectId ||
                    publicSubjects.filter((ps) => !subjects.some((s) => s.subject_id === ps.id)).length === 0
                  }
                  className="flex-1 h-11 clay-btn clay-btn-primary text-xs font-extrabold rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {enrolling ? 'Enrolling...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Persistent Bottom Navigation */}
      <BottomNav activeTab="records" />
    </div>
  );
}
