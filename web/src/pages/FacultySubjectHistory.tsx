import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, X, AlertCircle, Trash2, Upload, Download, FileSpreadsheet } from 'lucide-react';

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

    // If current status is APPROVED, default next status to REJECTED; otherwise APPROVED
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

      // Update that cell and the row's totals in-place without a full reload
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

          // Recompute present count and percentage
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

    let badgeClass = 'bg-gray-100 text-gray-700 border-gray-300';
    let text = 'Absent';

    if (status === 'APPROVED') {
      badgeClass = 'bg-green-100 text-green-800 border-green-300';
      text = 'Present';
    } else if (status === 'REJECTED') {
      badgeClass = 'bg-red-100 text-red-800 border-red-300';
      text = 'Rejected';
    } else if (status === 'PENDING') {
      badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-300';
      text = 'Pending';
    }

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeClass}`}>
        {isEdited && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 flex-shrink-0 animate-pulse"
            title={rec?.edit_reason ? `Edited: ${rec.edit_reason}` : 'Edited by faculty'}
          />
        )}
        {text}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/faculty/dashboard')}
              className="p-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-600"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                  {data?.subject.code || '...'}
                </span>
                <h1 className="text-2xl font-bold text-gray-900">
                  {data?.subject.name || 'Subject History'}
                </h1>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
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
              className={`inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-semibold shadow-sm cursor-pointer transition-colors ${
                isUploadingSheet
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <Upload className={`h-4 w-4 mr-1.5 ${isUploadingSheet ? 'animate-bounce' : ''}`} />
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
                className="inline-flex items-center px-3.5 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                <Download className={`h-4 w-4 mr-1.5 ${isDownloadingSheet ? 'animate-spin' : ''}`} />
                {isDownloadingSheet ? 'Downloading...' : 'Download Excel'}
              </button>
            )}

            <button
              onClick={fetchHistory}
              disabled={loading}
              className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => navigate('/faculty/dashboard')}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold rounded-lg shadow-sm transition-colors"
            >
              Dashboard
            </button>
          </div>
        </header>

        {/* Master Excel Banner */}
        <div className="flex flex-wrap items-center justify-between bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm text-sm gap-2">
          <div className="flex items-center gap-2 text-gray-700">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span className="font-semibold text-gray-900">Master Sheet:</span>
            {data?.subject.master_sheet_path ? (
              <span className="text-gray-600">
                Last updated {data.subject.master_sheet_updated_at ? new Date(data.subject.master_sheet_updated_at).toLocaleString() : 'recently'}
              </span>
            ) : (
              <span className="text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 text-xs font-semibold">
                Upload a blank .xlsx to start the sheet
              </span>
            )}
          </div>
          {sheetMessage && (
            <span className="text-xs text-emerald-600 font-semibold">{sheetMessage}</span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-start gap-2 shadow-sm">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Matrix Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading && !data ? (
            <div className="flex justify-center items-center py-24 text-gray-500">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mr-3" />
              <span className="text-base font-medium">Loading subject history...</span>
            </div>
          ) : !data || data.students.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <p className="text-base font-semibold text-gray-700">No students enrolled</p>
              <p className="text-sm text-gray-500 mt-1">There are no students enrolled in this subject.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="bg-gray-50 sticky top-0 z-30">
                  <tr>
                    {/* Sticky Student Column Header */}
                    <th
                      scope="col"
                      className="sticky left-0 bg-gray-50 z-40 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-r border-gray-200 min-w-[180px] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)]"
                    >
                      Student
                    </th>

                    {/* Summary Columns */}
                    <th scope="col" className="px-3 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200 min-w-[70px]">
                      Present
                    </th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-200 min-w-[60px]">
                      Total
                    </th>
                    <th scope="col" className="px-3 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-r border-gray-200 min-w-[65px]">
                      %
                    </th>

                    {/* Session Columns (newest first) */}
                    {data.sessions.map((sess) => {
                      const { datePart, timePart } = formatSessionDate(sess.started_at);
                      return (
                        <th
                          key={sess.id}
                          scope="col"
                          className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[120px]"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-bold text-gray-900">{datePart}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteModal(sess);
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete session"
                              aria-label={`Delete session ${datePart}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="text-[11px] text-gray-500 font-mono text-left">{timePart}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-100">
                  {data.students.map((student) => (
                    <tr key={student.student_id} className="hover:bg-blue-50/20 transition-colors">
                      {/* Sticky Student Column */}
                      <td className="sticky left-0 bg-white z-20 px-4 py-3 text-sm border-r border-gray-200 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)]">
                        <div className="font-bold text-gray-900">{student.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{student.student_id}</div>
                      </td>

                      {/* Summary Values */}
                      <td className="px-3 py-3 text-center text-sm font-semibold text-green-700 font-mono">
                        {student.present}
                      </td>
                      <td className="px-3 py-3 text-center text-sm text-gray-600 font-mono">
                        {student.total}
                      </td>
                      <td className="px-3 py-3 text-center text-sm border-r border-gray-200">
                        <span
                          className={`inline-block font-extrabold text-xs px-2 py-0.5 rounded-full ${
                            student.percentage >= 75
                              ? 'bg-green-100 text-green-800'
                              : student.percentage >= 50
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
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
                            className="px-3 py-2 text-center text-xs border-r border-gray-100 cursor-pointer hover:bg-blue-100/40 transition-colors"
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
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Edit Attendance Record</h3>
                <button
                  onClick={closeEditModal}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-bold">Student</p>
                  <p className="font-semibold text-gray-900 text-base">
                    {editingCell.student.name} ({editingCell.student.student_id})
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-bold">Session Date & Time</p>
                  <p className="font-medium text-gray-800 text-sm">
                    {new Date(editingCell.sessionDate).toLocaleString()}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1">Current Status</p>
                  {renderCellChip(editingCell.currentRecord)}
                  {editingCell.currentRecord.edited && editingCell.currentRecord.edit_reason && (
                    <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mt-2">
                      <span className="font-semibold">Current reason:</span> {editingCell.currentRecord.edit_reason}
                    </p>
                  )}
                </div>

                {modalError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    New Status
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTargetStatus('APPROVED')}
                      className={`py-2.5 px-3 rounded-lg border text-sm font-semibold flex items-center justify-center transition-all ${
                        targetStatus === 'APPROVED'
                          ? 'border-green-500 bg-green-50 text-green-700 ring-2 ring-green-500/20'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Present (APPROVED)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetStatus('REJECTED')}
                      className={`py-2.5 px-3 rounded-lg border text-sm font-semibold flex items-center justify-center transition-all ${
                        targetStatus === 'REJECTED'
                          ? 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500/20'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Not present (REJECTED)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for edit <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter reason (min 5 characters, e.g. Excused absence approved)"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">Minimum 5 characters required.</p>
                </div>
              </div>

              <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSubmitting || editReason.trim().length < 5}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deletingSession && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <div className="flex items-center gap-2 text-red-600">
                  <Trash2 className="h-5 w-5" />
                  <h3 className="text-lg font-bold text-gray-900">Delete Session</h3>
                </div>
                <button
                  onClick={closeDeleteModal}
                  disabled={isDeleting}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-bold">Session Date</p>
                  <p className="font-semibold text-gray-900 text-base mt-0.5">
                    {new Date(deletingSession.started_at).toLocaleString()}
                  </p>
                </div>

                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
                  This permanently deletes {deletingSession.recordCount} attendance records and cannot be undone
                </div>

                {deleteError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{deleteError}</span>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={isDeleting}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
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
    </div>
  );
}
