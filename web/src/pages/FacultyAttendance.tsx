import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit3, Download, RefreshCw, X, AlertCircle, MapPin, Wifi } from 'lucide-react';

interface AttendanceRow {
  student_id: string;
  user_id: string;
  name: string;
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | null;
  face_match_score?: number | null;
  liveness_score?: number | null;
  edit_reason?: string | null;
  location_distance_m?: number | null;
  location_accuracy_m?: number | null;
  location_verified?: boolean | null;
  wifi_bssid?: string | null;
  wifi_ssid?: string | null;
  wifi_verified?: boolean | null;
  wifi_verification_status?: string | null;
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

  const openEditModal = (student: AttendanceRow) => {
    setEditingStudent(student);
    // If current status is APPROVED, default next status to REJECTED; otherwise APPROVED
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
      // Refresh list after saving
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
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 border border-green-300">
          Present (APPROVED)
        </span>
      );
    }
    if (status === 'REJECTED') {
      return (
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 border border-red-300">
          Not present (REJECTED)
        </span>
      );
    }
    if (status === 'PENDING') {
      return (
        <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">
          PENDING
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 border border-gray-300">
        Absent (No Record)
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate(`/session/${id}/review`)}
              className="p-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-600"
              title="Back to Review"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Session Attendance Roster</h1>
              <p className="text-sm text-gray-500">Manage and override student attendance records</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAttendance}
              disabled={loading}
              className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => navigate(`/session/${id}/review`)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
            >
              Live Review
            </button>
            <button
              onClick={handleDownloadExcel}
              disabled={downloading}
              className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? 'Downloading...' : 'Download Excel'}
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-6">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Student ID
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Face Match
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Liveness
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Presence
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Edit Reason
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading && students.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                      <div className="flex justify-center items-center">
                        <RefreshCw className="h-6 w-6 animate-spin text-blue-600 mr-2" />
                        Loading attendance roster...
                      </div>
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                      No enrolled students found for this session.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.user_id || student.student_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                        {student.student_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {student.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {renderStatusBadge(student.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {student.face_match_score !== null && student.face_match_score !== undefined
                          ? `${Math.round(student.face_match_score * 100)}%`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {student.liveness_score !== null && student.liveness_score !== undefined
                          ? `${Math.round(student.liveness_score * 100)}%`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        <div className="flex flex-col gap-1 items-start">
                          {student.location_verified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <MapPin className="h-3 w-3" />
                              <span>{student.location_distance_m !== null && student.location_distance_m !== undefined ? `${Math.round(student.location_distance_m)}m` : 'GPS In-Room'}</span>
                            </span>
                          ) : null}
                          {student.wifi_verified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200" title={student.wifi_bssid || 'Verified Wi-Fi AP'}>
                              <Wifi className="h-3 w-3" />
                              <span>Wi-Fi AP</span>
                            </span>
                          ) : student.wifi_verification_status === 'UNAPPROVED_ACCESS_POINT' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200" title={`Unapproved AP: ${student.wifi_bssid || ''}`}>
                              <Wifi className="h-3 w-3" />
                              <span>Wrong AP</span>
                            </span>
                          ) : null}
                          {!student.location_verified && !student.wifi_verified && student.status ? (
                            <span className="text-xs text-gray-400">Remote / None</span>
                          ) : null}
                          {!student.status ? '—' : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={student.edit_reason || ''}>
                        {student.edit_reason ? (
                          <span className="inline-flex items-center text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs border border-amber-200">
                            {student.edit_reason}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => openEditModal(student)}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-semibold rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                        >
                          <Edit3 className="h-3.5 w-3.5 mr-1 text-gray-500" />
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
                  <p className="text-sm text-gray-500">Student</p>
                  <p className="font-semibold text-gray-900 text-base">{editingStudent.name} ({editingStudent.student_id})</p>
                </div>

                <div>
                  <p className="text-sm text-gray-500 mb-1">Current Status</p>
                  {renderStatusBadge(editingStudent.status)}
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
                    placeholder="Enter reason (min 5 characters, e.g. Verified physical presence in class)"
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
      </div>
    </div>
  );
}
