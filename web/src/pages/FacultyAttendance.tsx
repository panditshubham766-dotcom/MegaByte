import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit3, Download, RefreshCw, X, AlertCircle, Eye, LogOut } from 'lucide-react';

interface AttendanceRow {
  student_id: string;
  user_id: string;
  name: string;
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | null;
  face_match_score?: number | null;
  liveness_score?: number | null;
  edit_reason?: string | null;
}

export default function FacultyAttendance() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [students, setStudents] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState<AttendanceRow | null>(null);
  const [targetStatus, setTargetStatus] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [editReason, setEditReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAttendance = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}/attendance`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Forbidden: You do not own this session');
        }
        throw new Error('Failed to load session attendance');
      }

      const data: AttendanceRow[] = await response.json();
      setStudents(data);
      setError('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading attendance list');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

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
      let filename = `attendance_${id}.xlsx`;
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

  const openEditModal = (student: AttendanceRow) => {
    setEditingStudent(student);
    const defaultNext: 'APPROVED' | 'REJECTED' = student.status === 'APPROVED' ? 'REJECTED' : 'APPROVED';
    setTargetStatus(defaultNext);
    setEditReason('');
    setModalError('');
  };

  const closeEditModal = () => {
    setEditingStudent(null);
    setEditReason('');
    setModalError('');
  };

  const handleSaveEdit = async () => {
    if (!editingStudent || !id) return;

    const trimmed = editReason.trim();
    if (trimmed.length < 5) {
      setModalError('Reason must be at least 5 characters');
      return;
    }

    if (editingStudent.status === targetStatus) {
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
          sessionId: id,
          studentId: editingStudent.user_id || editingStudent.student_id,
          status: targetStatus,
          reason: trimmed
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Failed to update attendance');
      }

      closeEditModal();
      await fetchAttendance();
    } catch (err: any) {
      console.error('Error saving attendance edit:', err);
      setModalError(err.message || 'Error updating attendance');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusBadge = (status: AttendanceRow['status']) => {
    if (status === 'APPROVED') {
      return (
        <span className="clay-chip clay-chip-success">
          Present (APPROVED)
        </span>
      );
    }
    if (status === 'REJECTED') {
      return (
        <span className="clay-chip clay-chip-danger">
          Not present (REJECTED)
        </span>
      );
    }
    if (status === 'PENDING') {
      return (
        <span className="clay-chip clay-chip-warning">
          Pending
        </span>
      );
    }
    return (
      <span className="clay-chip clay-chip-neutral">
        Absent
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
                onClick={() => navigate(`/session/${id}`)}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                Code
              </button>
              <button
                type="button"
                onClick={() => navigate(`/session/${id}/review`)}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
              >
                Live Review
              </button>
              <span className="clay-chip clay-chip-pressed text-xs">
                Attendance table
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
        {/* Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 clay-card p-4 sm:p-6">
          <div>
            <h1 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">Session Attendance Roster</h1>
            <p className="text-xs font-semibold text-[#5B5F8A] mt-1">Manage and override student attendance records</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={fetchAttendance}
              disabled={loading}
              className="clay-btn clay-btn-secondary p-2.5 rounded-full disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-[#5B5F8A] ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => navigate(`/session/${id}/review`)}
              className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs rounded-full"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5 text-[#5B5F8A]" />
              Live Review
            </button>
            <button
              onClick={handleDownloadExcel}
              disabled={downloading}
              className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs rounded-full disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 mr-1.5 text-[#5B5F8A]" />
              {downloading ? 'Downloading...' : 'Download Excel'}
            </button>
          </div>
        </div>

        {error && (
          <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full">
            {error}
          </div>
        )}

        {/* Wide table scrollable inside its own container - inside it keep rows and cells FLAT */}
        <div className="clay-card p-4 sm:p-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/60">
              <thead>
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Student ID
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Face Match
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Liveness
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left label-clay">
                    Edit Reason
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right label-clay">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50">
                {loading && students.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center text-xs font-bold text-[#5B5F8A]">
                      <div className="flex justify-center items-center">
                        <RefreshCw className="h-5 w-5 animate-spin text-[#5B4BF0] mr-2" />
                        Loading attendance roster...
                      </div>
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center text-xs font-semibold text-[#5B5F8A]">
                      No enrolled students found for this session.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.user_id || student.student_id} className="hover:bg-white/60 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-xs font-mono font-bold text-[#1B1640]">
                        {student.student_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs font-extrabold text-[#1B1640]">
                        {student.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        {renderStatusBadge(student.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-[#5B5F8A] font-mono font-bold">
                        {student.face_match_score !== null && student.face_match_score !== undefined
                          ? `${Math.round(student.face_match_score * 100)}%`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-[#5B5F8A] font-mono font-bold">
                        {student.liveness_score !== null && student.liveness_score !== undefined
                          ? `${Math.round(student.liveness_score * 100)}%`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs text-[#5B5F8A] max-w-xs truncate" title={student.edit_reason || ''}>
                        {student.edit_reason ? (
                          <span className="clay-chip clay-chip-warning text-[10px]">
                            {student.edit_reason}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                        <button
                          onClick={() => openEditModal(student)}
                          className="clay-btn clay-btn-secondary px-3 py-1.5 text-xs rounded-full"
                        >
                          <Edit3 className="h-3 w-3 mr-1 text-[#5B5F8A]" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit Modal */}
        {editingStudent && (
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
                  <p className="font-extrabold text-[#1B1640] text-sm mt-0.5">{editingStudent.name} ({editingStudent.student_id})</p>
                </div>

                <div>
                  <p className="label-clay block mb-1.5">Current Status</p>
                  {renderStatusBadge(editingStudent.status)}
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
                    placeholder="Enter reason (min 5 characters, e.g. Verified physical presence in class)"
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
      </main>
    </div>
  );
}
