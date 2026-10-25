import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, X, AlertCircle, Trash2, Upload, Download, FileSpreadsheet, LogOut } from 'lucide-react';

interface SessionCol {
  id: string;
  started_at: string;
  status: string;
}

interface StudentRecord {
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | null;
  edited: boolean;
  edit_reason: string | null;
}

interface StudentRow {
  student_id: string;
  user_id?: string;
  name: string;
  present: number;
  total: number;
  percentage: number;
  records: Record<string, StudentRecord>;
}

interface SubjectInfo {
  id: string;
  code: string;
  name: string;
  master_sheet_path?: string | null;
  master_sheet_updated_at?: string | null;
}

interface HistoryData {
  subject: SubjectInfo;
  sessions: SessionCol[];
  students: StudentRow[];
}

export default function FacultySubjectHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Master Sheet state
  const [isUploadingSheet, setIsUploadingSheet] = useState(false);
  const [isDownloadingSheet, setIsDownloadingSheet] = useState(false);
  const [sheetMessage, setSheetMessage] = useState('');

  // Edit Modal State
  const [editingCell, setEditingCell] = useState<{
    student: StudentRow;
    sessionId: string;
    sessionDate: string;
    currentRecord: StudentRecord;
  } | null>(null);

  const [targetStatus, setTargetStatus] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [editReason, setEditReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Session Modal State
  const [deletingSession, setDeletingSession] = useState<{
    id: string;
    started_at: string;
    recordCount: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openDeleteModal = (sess: SessionCol) => {
    if (!data) return;
    const count = data.students.filter(
      (st) => st.records[sess.id] && st.records[sess.id].status !== null
    ).length;

    setDeletingSession({
      id: sess.id,
      started_at: sess.started_at,
      recordCount: count
    });
    setDeleteError('');
  };

  const closeDeleteModal = () => {
    setDeletingSession(null);
    setDeleteError('');
  };

  const handleConfirmDelete = async () => {
    if (!deletingSession || !data) return;
    setIsDeleting(true);
    setDeleteError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${deletingSession.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const resJson = await response.json().catch(() => ({}));
        throw new Error(resJson.message || 'Failed to delete session');
      }

      // Remove the column and recompute totals in-place
      const deletedSessionId = deletingSession.id;

      setData((prev) => {
        if (!prev) return prev;
        const updatedSessions = prev.sessions.filter((s) => s.id !== deletedSessionId);
        const updatedStudents = prev.students.map((st) => {
          const updatedRecords = { ...st.records };
          delete updatedRecords[deletedSessionId];

          let presentCount = 0;
          for (const sess of updatedSessions) {
            if (updatedRecords[sess.id]?.status === 'APPROVED') {
              presentCount++;
            }
          }
          const total = updatedSessions.length;
          const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

          return {
            ...st,
            present: presentCount,
            total,
            percentage,
            records: updatedRecords
          };
        });

        return {
          ...prev,
          sessions: updatedSessions,
          students: updatedStudents
        };
      });

      closeDeleteModal();
    } catch (err: any) {
      console.error('Error deleting session:', err);
      setDeleteError(err.message || 'Error deleting session');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    if (!file.name.endsWith('.xlsx')) {
      alert('Please select a valid .xlsx Excel file');
      return;
    }

    setIsUploadingSheet(true);
    setSheetMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/subjects/${id}/sheet`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to upload Excel sheet');
      }

      setSheetMessage('Excel sheet uploaded & synced successfully!');
      setTimeout(() => setSheetMessage(''), 4000);
      await fetchHistory();
    } catch (err: any) {
      console.error('Error uploading master sheet:', err);
      alert(err.message || 'Failed to upload Excel sheet');
    } finally {
      setIsUploadingSheet(false);
      e.target.value = '';
    }
  };

  const handleDownloadExcel = async () => {
    if (!id || !data?.subject) return;
    setIsDownloadingSheet(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/subjects/${id}/sheet/download`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to download master Excel sheet');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.subject.code}_master_attendance.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Error downloading master sheet:', err);
      alert(err.message || 'Failed to download master sheet');
    } finally {
      setIsDownloadingSheet(false);
    }
  };

  const fetchHistory = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/subjects/${id}/history`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Forbidden: You do not own this subject');
        } else if (response.status === 404) {
          throw new Error('Subject not found');
        }
        throw new Error('Failed to load subject attendance history');
      }

      const resData: HistoryData = await response.json();
      setData(resData);
      setError('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading subject history');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const openEditModal = (student: StudentRow, sessionId: string, startedAt: string) => {
    const record = student.records[sessionId] || {
      status: null,
      edited: false,
      edit_reason: null
    };

    const defaultTarget = record.status === 'APPROVED' ? 'REJECTED' : 'APPROVED';

    setEditingCell({
      student,
      sessionId,
      sessionDate: startedAt,
      currentRecord: record
    });
    setTargetStatus(defaultTarget);
    setEditReason(record.edit_reason || '');
    setModalError('');
  };

  const closeEditModal = () => {
    setEditingCell(null);
    setEditReason('');
    setModalError('');
  };

  const handleSaveEdit = async () => {
    if (!editingCell || !data) return;

    const trimmed = editReason.trim();
    if (trimmed.length < 5) {
      setModalError('Reason must be at least 5 characters');
      return;
    }

    if (editingCell.currentRecord.status === targetStatus) {
      setModalError('New status cannot be the same as current status');
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/attendance/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId: editingCell.sessionId,
          studentId: editingCell.student.user_id || editingCell.student.student_id,
          status: targetStatus,
          reason: trimmed
        })
      });

      const resJson = await response.json();
      if (!response.ok) {
        throw new Error(resJson.message || 'Failed to update attendance');
      }

      const { sessionId, student } = editingCell;
      const targetStudentId = student.student_id;

      setData(prev => {
        if (!prev) return prev;

        const updatedStudents = prev.students.map(st => {
          if (st.student_id !== targetStudentId) return st;

          const updatedRecords = {
            ...st.records,
            [sessionId]: {
              status: targetStatus,
              edited: true,
              edit_reason: trimmed
            }
          };

          let presentCount = 0;
          for (const sess of prev.sessions) {
            if (updatedRecords[sess.id]?.status === 'APPROVED') {
              presentCount++;
            }
          }

          const total = prev.sessions.length;
          const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

          return {
            ...st,
            present: presentCount,
            percentage,
            records: updatedRecords
          };
        });

        return {
          ...prev,
          students: updatedStudents
        };
      });

      closeEditModal();
    } catch (err: any) {
      console.error('Error saving attendance edit:', err);
      setModalError(err.message || 'Error updating attendance');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const formatSessionDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
      return { datePart, timePart };
    } catch {
      return { datePart: dateStr, timePart: '' };
    }
  };

  const renderCellChip = (rec?: StudentRecord) => {
    const status = rec?.status;
    const isEdited = rec?.edited;

    let chipClass = 'clay-chip clay-chip-neutral';
    let text = 'Absent';

    if (status === 'APPROVED') {
      chipClass = 'clay-chip clay-chip-success';
      text = 'Present';
    } else if (status === 'REJECTED') {
      chipClass = 'clay-chip clay-chip-danger';
      text = 'Rejected';
    } else if (status === 'PENDING') {
      chipClass = 'clay-chip clay-chip-warning';
      text = 'Pending';
    }

    return (
      <span className={`text-[11px] font-extrabold ${chipClass}`}>
        {isEdited && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#D97706] mr-1 flex-shrink-0 animate-pulse"
            title={rec?.edit_reason ? `Edited: ${rec.edit_reason}` : 'Edited by faculty'}
          />
        )}
        {text}
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
              <span className="clay-chip clay-chip-pressed text-xs">
                Subject history
              </span>
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
        {/* Header card with subject details and action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4 clay-card p-4 sm:p-6">
          <div className="flex items-center space-x-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="clay-chip clay-chip-pressed text-[10px]">
                  {data?.subject.code || '...'}
                </span>
                <h1 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">
                  {data?.subject.name || 'Subject History'}
                </h1>
              </div>
              <p className="text-xs font-semibold text-[#5B5F8A] mt-1">
                Full session attendance grid & overrides
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              id="master-sheet-input"
              accept=".xlsx"
              className="hidden"
              onChange={handleUploadExcel}
            />
            <label
              htmlFor="master-sheet-input"
              className={`clay-btn clay-btn-success px-4 py-2 text-xs rounded-full cursor-pointer ${
                isUploadingSheet ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Upload className={`h-3.5 w-3.5 mr-1.5 ${isUploadingSheet ? 'animate-bounce' : ''}`} />
              {isUploadingSheet
                ? 'Uploading...'
                : data?.subject.master_sheet_path
                ? 'Replace Excel'
                : 'Upload Excel'}
            </label>

            {data?.subject.master_sheet_path && (
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={isDownloadingSheet}
                className="clay-btn clay-btn-secondary px-4 py-2 text-xs rounded-full disabled:opacity-50"
              >
                <Download className={`h-3.5 w-3.5 mr-1.5 text-[#5B5F8A] ${isDownloadingSheet ? 'animate-spin' : ''}`} />
                {isDownloadingSheet ? 'Downloading...' : 'Download Excel'}
              </button>
            )}

            <button
              onClick={fetchHistory}
              disabled={loading}
              className="clay-btn clay-btn-secondary p-2.5 rounded-full disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-[#5B5F8A] ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => navigate('/faculty/dashboard')}
              className="clay-btn clay-btn-secondary px-4 py-2 text-xs rounded-full"
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* Master Excel Banner */}
        <div className="flex flex-wrap items-center justify-between clay-card px-5 py-3.5 text-xs gap-2">
          <div className="flex items-center gap-2 text-[#1B1640]">
            <FileSpreadsheet className="h-4 w-4 text-[#34D399] flex-shrink-0" />
            <span className="font-extrabold">Master Sheet:</span>
            {data?.subject.master_sheet_path ? (
              <span className="font-semibold text-[#5B5F8A]">
                Last updated {data.subject.master_sheet_updated_at ? new Date(data.subject.master_sheet_updated_at).toLocaleString() : 'recently'}
              </span>
            ) : (
              <span className="clay-chip clay-chip-warning text-[10px]">
                Upload a blank .xlsx to start the sheet
              </span>
            )}
          </div>
          {sheetMessage && (
            <span className="text-xs text-[#065F46] font-extrabold">{sheetMessage}</span>
          )}
        </div>

        {error && (
          <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Matrix Table inside one clay-card container, rows and cells FLAT */}
        <div className="clay-card p-4 sm:p-6 overflow-hidden">
          {loading && !data ? (
            <div className="flex justify-center items-center py-24 text-[#5B5F8A]">
              <RefreshCw className="h-6 w-6 animate-spin text-[#5B4BF0] mr-3" />
              <span className="text-sm font-bold">Loading subject history...</span>
            </div>
          ) : !data || data.students.length === 0 ? (
            <div className="p-12 text-center text-[#5B5F8A]">
              <p className="text-base font-extrabold text-[#1B1640]">No students enrolled</p>
              <p className="text-xs font-semibold text-[#5B5F8A] mt-1">There are no students enrolled in this subject.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-30 bg-[#F4F6FD]">
                  <tr>
                    {/* Sticky Student Column Header */}
                    <th
                      scope="col"
                      className="sticky left-0 bg-[#F4F6FD] z-40 px-4 py-3 text-left label-clay border-b border-r border-slate-200/80 min-w-[180px] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)]"
                    >
                      Student
                    </th>

                    {/* Summary Columns */}
                    <th scope="col" className="px-3 py-3 text-center label-clay border-b border-slate-200/80 min-w-[70px]">
                      Present
                    </th>
                    <th scope="col" className="px-3 py-3 text-center label-clay border-b border-slate-200/80 min-w-[60px]">
                      Total
                    </th>
                    <th scope="col" className="px-3 py-3 text-center label-clay border-b border-r border-slate-200/80 min-w-[65px]">
                      %
                    </th>

                    {/* Session Columns (newest first) */}
                    {data.sessions.map((sess) => {
                      const { datePart, timePart } = formatSessionDate(sess.started_at);
                      return (
                        <th
                          key={sess.id}
                          scope="col"
                          className="px-3 py-2 text-center text-xs font-extrabold text-[#1B1640] border-b border-r border-slate-200/80 min-w-[120px]"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-extrabold text-[#1B1640] text-xs">{datePart}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteModal(sess);
                              }}
                              className="p-1 text-slate-400 hover:text-[#F43F5E] hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete session"
                              aria-label={`Delete session ${datePart}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="text-[11px] text-[#5B5F8A] font-mono font-semibold text-left">{timePart}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Rows and cells FLAT (no per-cell shadows) */}
                <tbody className="divide-y divide-slate-200/50 bg-white/40">
                  {data.students.map((student) => (
                    <tr key={student.student_id} className="hover:bg-white/80 transition-colors">
                      {/* Sticky Student Column */}
                      <td className="sticky left-0 bg-[#FBFBFF] z-20 px-4 py-3 text-xs border-r border-slate-200/80 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)]">
                        <div className="font-extrabold text-[#1B1640]">{student.name}</div>
                        <div className="text-[11px] font-mono font-bold text-[#5B5F8A] mt-0.5">{student.student_id}</div>
                      </td>

                      {/* Summary Values */}
                      <td className="px-3 py-3 text-center text-xs font-extrabold text-[#065F46] font-mono">
                        {student.present}
                      </td>
                      <td className="px-3 py-3 text-center text-xs font-bold text-[#5B5F8A] font-mono">
                        {student.total}
                      </td>
                      <td className="px-3 py-3 text-center text-xs border-r border-slate-200/80">
                        <span
                          className={`inline-block font-black text-[11px] px-2.5 py-0.5 rounded-full ${
                            student.percentage >= 75
                              ? 'bg-emerald-100 text-[#065F46]'
                              : student.percentage >= 50
                              ? 'bg-amber-100 text-[#92400E]'
                              : 'bg-rose-100 text-[#9F1239]'
                          }`}
                        >
                          {student.percentage}%
                        </span>
                      </td>

                      {/* Session Cells */}
                      {data.sessions.map((sess) => {
                        const rec = student.records[sess.id];
                        return (
                          <td
                            key={sess.id}
                            onClick={() => openEditModal(student, sess.id, sess.started_at)}
                            className="px-3 py-2 text-center text-xs border-r border-slate-200/50 cursor-pointer hover:bg-blue-50/50 transition-colors"
                            title="Click to edit status"
                          >
                            {renderCellChip(rec)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {editingCell && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="clay-card max-w-md w-full overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-slate-200/60">
                <h3 className="text-base font-extrabold text-[#1B1640]">Edit Attendance Record</h3>
                <button
                  onClick={closeEditModal}
                  className="p-1.5 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <p className="label-clay block">Student</p>
                  <p className="font-extrabold text-[#1B1640] text-sm mt-0.5">
                    {editingCell.student.name} ({editingCell.student.student_id})
                  </p>
                </div>

                <div>
                  <p className="label-clay block">Session Date & Time</p>
                  <p className="font-bold text-[#1B1640] text-xs mt-0.5">
                    {new Date(editingCell.sessionDate).toLocaleString()}
                  </p>
                </div>

                <div>
                  <p className="label-clay block mb-1.5">Current Status</p>
                  {renderCellChip(editingCell.currentRecord)}
                  {editingCell.currentRecord.edited && editingCell.currentRecord.edit_reason && (
                    <p className="text-xs text-[#92400E] bg-amber-50 p-2.5 rounded-2xl border border-amber-200 mt-2">
                      <span className="font-bold">Current reason:</span> {editingCell.currentRecord.edit_reason}
                    </p>
                  )}
                </div>

                {modalError && (
                  <div className="clay-chip-danger px-3 py-2 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div>
                  <label className="label-clay block mb-2">
                    New Status
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTargetStatus('APPROVED')}
                      className={`py-2.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center transition-all ${
                        targetStatus === 'APPROVED'
                          ? 'clay-chip-pressed'
                          : 'clay-chip clay-chip-selectable clay-chip-neutral'
                      }`}
                    >
                      Present (APPROVED)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetStatus('REJECTED')}
                      className={`py-2.5 px-3 rounded-full text-xs font-extrabold flex items-center justify-center transition-all ${
                        targetStatus === 'REJECTED'
                          ? 'clay-chip-pressed'
                          : 'clay-chip clay-chip-selectable clay-chip-neutral'
                      }`}
                    >
                      Not present (REJECTED)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label-clay block mb-1.5">
                    Reason for edit <span className="text-[#F43F5E]">*</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter reason (min 5 characters, e.g. Excused absence approved)"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="w-full px-4 py-3 clay-input text-xs"
                  />
                  <p className="text-[11px] font-semibold text-[#5B5F8A] mt-1">Minimum 5 characters required.</p>
                </div>
              </div>

              <div className="px-6 py-4 flex items-center justify-end gap-3 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 clay-btn clay-btn-secondary text-xs rounded-full disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSubmitting || editReason.trim().length < 5}
                  className="px-5 py-2.5 clay-btn clay-btn-primary text-xs rounded-full disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deletingSession && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="clay-card max-w-md w-full overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-slate-200/60">
                <div className="flex items-center gap-2 text-[#F43F5E]">
                  <Trash2 className="h-5 w-5" />
                  <h3 className="text-base font-extrabold text-[#1B1640]">Delete Session</h3>
                </div>
                <button
                  onClick={closeDeleteModal}
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
                    {new Date(deletingSession.started_at).toLocaleString()}
                  </p>
                </div>

                <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full">
                  This permanently deletes {deletingSession.recordCount} attendance records and cannot be undone
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
                  onClick={closeDeleteModal}
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
      </main>
    </div>
  );
}
