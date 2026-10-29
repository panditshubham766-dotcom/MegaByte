import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Play, History, X, MapPin, RefreshCw, Plus, Edit2, Trash2, BookOpen, AlertTriangle } from 'lucide-react';
import { laptopTracker, type LaptopReading } from '../services/laptopLocationTracker';

interface SubjectItem {
  id: string;
  code: string;
  name: string;
  session_count: number;
}

export default function FacultyDashboard() {
  const [lockedReading, setLockedReading] = useState<LaptopReading | null>(laptopTracker.lockedReading);
  const [trackerState, setTrackerState] = useState({
    isLocating: laptopTracker.isLocating,
    isLocked: laptopTracker.isLocked,
    error: laptopTracker.error,
    permissionDenied: laptopTracker.permissionDenied,
    timeoutOccurred: laptopTracker.timeoutOccurred,
  });
  const [presetSeconds, setPresetSeconds] = useState(300);
  const [isCustom, setIsCustom] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customSec, setCustomSec] = useState('');
  const [loading, setLoading] = useState(false);

  // Subject management state
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');

  // Add Subject Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Rename Subject Modal state
  const [editingSubject, setEditingSubject] = useState<SubjectItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Delete Subject Modal state
  const [deletingSubject, setDeletingSubject] = useState<SubjectItem | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const navigate = useNavigate();

  const fetchSubjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/subjects`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data: SubjectItem[] = await response.json();
        setSubjects(data);
        if (data.length > 0) {
          let remembered = '';
          try {
            remembered = localStorage.getItem('last_used_subject_id') || '';
          } catch {}

          if (remembered && data.some((s) => s.id === remembered)) {
            setSelectedSubjectId(remembered);
          } else {
            setSelectedSubjectId(data[0].id);
            try {
              localStorage.setItem('last_used_subject_id', data[0].id);
            } catch {}
          }
        } else {
          setSelectedSubjectId('');
        }
      }
    } catch (e) {
      console.error('Error fetching subjects:', e);
    }
  };

  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const token = localStorage.getItem('token');
        const API_URL = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${API_URL}/api/sessions/active`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          navigate(`/session/${data.id}`);
        }
      } catch (error) {
        console.error('Error checking active session:', error);
      }
    };

    checkActiveSession();
    fetchSubjects();
  }, [navigate]);

  useEffect(() => {
    laptopTracker.startLock();
    const unsub = laptopTracker.subscribe(() => {
      setLockedReading(laptopTracker.lockedReading);
      setTrackerState({
        isLocating: laptopTracker.isLocating,
        isLocked: laptopTracker.isLocked,
        error: laptopTracker.error,
        permissionDenied: laptopTracker.permissionDenied,
        timeoutOccurred: laptopTracker.timeoutOccurred,
      });
    });
    return () => {
      unsub();
      laptopTracker.stop();
    };
  }, []);

  const handleSubjectHistory = () => {
    if (subjects.length === 0) {
      alert('Add a subject first.');
      return;
    }
    let targetId = selectedSubjectId;
    try {
      const stored = localStorage.getItem('last_used_subject_id');
      if (stored && subjects.some((s) => s.id === stored)) {
        targetId = stored;
      }
    } catch {}

    if (!targetId && subjects.length > 0) {
      targetId = subjects[0].id;
    }

    if (targetId) {
      navigate(`/subjects/${targetId}/history`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const minVal = customMin.trim() === '' ? 0 : Number(customMin);
  const secVal = customSec.trim() === '' ? 0 : Number(customSec);
  const isMinInteger = Number.isInteger(minVal) && minVal >= 0 && minVal <= 180;
  const isSecInteger = Number.isInteger(secVal) && secVal >= 0 && secVal <= 59;
  const totalCustomSeconds = isMinInteger && isSecInteger ? minVal * 60 + secVal : -1;
  const isCustomValid = isMinInteger && isSecInteger && totalCustomSeconds >= 15 && totalCustomSeconds <= 10800;
  const isCustomInvalid = isCustom && !isCustomValid;

  const formatLivePreview = (m: number, s: number) => {
    const parts: string[] = [];
    if (m > 0) parts.push(`${m} min`);
    if (s > 0 || m === 0) parts.push(`${s} sec`);
    return parts.join(' ');
  };

  const handleCreateSession = async () => {
    const reading = lockedReading || laptopTracker.lockedReading;
    if (!reading) {
      alert('Laptop location reading is required to start session.');
      return;
    }
    if (!selectedSubjectId) {
      alert('Please select a subject to start the session.');
      return;
    }

    setLoading(true);
    try {
      const chosenSeconds = isCustom ? (minVal * 60 + secVal) : presetSeconds;
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          durationSeconds: chosenSeconds,
          anchor_lat: reading.lat,
          anchor_lng: reading.lng,
          anchor_accuracy_m: reading.accuracy,
          subject_id: selectedSubjectId
        })
      });

      const data = await response.json();
      if (response.status === 409 && data.sessionId) {
        navigate(`/session/${data.sessionId}`);
        return;
      }
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create session');
      }

      try {
        localStorage.setItem('last_used_subject_id', selectedSubjectId);
      } catch {}

      navigate(`/session/${data.id}`);
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Failed to create session. Check console.');
    } finally {
      setLoading(false);
    }
  };

  // Add Subject Handlers
  const handleOpenAddModal = () => {
    setAddCode('');
    setAddName('');
    setAddError('');
    setShowAddModal(true);
  };

  const handleSubmitAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = addCode.trim().toUpperCase();
    const cleanName = addName.trim();

    if (!/^[A-Z0-9]{2,12}$/.test(cleanCode)) {
      setAddError('Subject code must be 2-12 letters and digits only');
      return;
    }
    if (cleanName.length < 2 || cleanName.length > 80) {
      setAddError('Subject name must be between 2 and 80 characters');
      return;
    }

    setIsAdding(true);
    setAddError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: cleanCode, name: cleanName })
      });

      const resData = await res.json();
      if (!res.ok) {
        setAddError(resData.message || (resData.code === 'SUBJECT_CODE_TAKEN' ? 'Subject code already taken' : 'Failed to add subject'));
        return;
      }

      setShowAddModal(false);
      setAddCode('');
      setAddName('');
      await fetchSubjects();
      setSelectedSubjectId(resData.id);
      try {
        localStorage.setItem('last_used_subject_id', resData.id);
      } catch {}
    } catch (err: any) {
      setAddError(err.message || 'Error creating subject');
    } finally {
      setIsAdding(false);
    }
  };

  // Rename Subject Handlers
  const handleOpenRenameModal = (sub: SubjectItem) => {
    setEditingSubject(sub);
    setEditName(sub.name);
    setEditError('');
  };

  const handleSubmitRenameSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubject) return;

    const cleanName = editName.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setEditError('Subject name must be between 2 and 80 characters');
      return;
    }

    setIsEditing(true);
    setEditError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects/${editingSubject.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: cleanName })
      });

      const resData = await res.json();
      if (!res.ok) {
        setEditError(resData.message || 'Failed to rename subject');
        return;
      }

      setEditingSubject(null);
      setEditName('');
      await fetchSubjects();
    } catch (err: any) {
      setEditError(err.message || 'Error renaming subject');
    } finally {
      setIsEditing(false);
    }
  };

  // Delete Subject Handlers
  const handleOpenDeleteModal = (sub: SubjectItem) => {
    setDeletingSubject(sub);
    setDeleteConfirmCode('');
    setDeleteError('');
  };

  const handleConfirmDeleteSubject = async () => {
    if (!deletingSubject) return;

    if (deletingSubject.session_count > 0) {
      if (deleteConfirmCode.trim().toUpperCase() !== deletingSubject.code.toUpperCase()) {
        setDeleteError('Please type the exact subject code to confirm.');
        return;
      }
    }

    setIsDeleting(true);
    setDeleteError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_URL}/api/subjects/${deletingSubject.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ confirm_code: deleteConfirmCode.trim() })
      });

      const resData = await res.json();
      if (!res.ok) {
        if (resData.code === 'SUBJECT_HAS_ACTIVE_SESSION') {
          setDeleteError('End the live session first');
        } else {
          setDeleteError(resData.message || 'Failed to delete subject');
        }
        return;
      }

      const deletedId = deletingSubject.id;
      setDeletingSubject(null);
      setDeleteConfirmCode('');

      try {
        if (localStorage.getItem('last_used_subject_id') === deletedId) {
          localStorage.removeItem('last_used_subject_id');
        }
      } catch {}

      await fetchSubjects();
    } catch (err: any) {
      setDeleteError(err.message || 'Error deleting subject');
    } finally {
      setIsDeleting(false);
    }
  };

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-6 lg:p-8">
      {/* Floating Rounded Clay Top Bar */}
      <header className="max-w-7xl w-full mx-auto mb-8">
        <div className="clay-topbar px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full clay-tile flex items-center justify-center font-black text-base text-[#5B4BF0]">
                M
              </div>
              <span className="font-extrabold text-xl text-[#1B1640] tracking-tight">MegaByte</span>
            </div>

            {/* Nav links as clay pills with active state */}
            <nav className="flex items-center gap-2">
              <span className="clay-chip clay-chip-pressed text-xs">
                Dashboard
              </span>
              <button
                type="button"
                onClick={handleSubjectHistory}
                className="clay-chip clay-chip-selectable clay-chip-neutral text-xs"
                title="View Subject Attendance Matrix"
              >
                <History className="h-3.5 w-3.5 mr-1 text-[#5B5F8A]" />
                Subject history
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user.name && (
              <span className="hidden md:inline-block text-xs font-bold text-[#5B5F8A]">
                {user.name}
              </span>
            )}
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

      {/* Main Content: Two columns on desktop */}
      <main className="flex-1 max-w-7xl w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Create Attendance Session */}
          <div className="lg:col-span-7 clay-card p-6 sm:p-8 space-y-6">
            <div className="text-center sm:text-left">
              <h2 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">Create Attendance Session</h2>
              <p className="text-xs font-semibold text-[#5B5F8A] mt-1">Configure subject, duration and start check-in</p>
            </div>

            {/* Subject Selector */}
            <div className="space-y-2">
              <label className="label-clay block">
                SUBJECT
              </label>
              {subjects.length > 0 ? (
                <div className="relative">
                  <select
                    value={selectedSubjectId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setSelectedSubjectId(newId);
                      try {
                        localStorage.setItem('last_used_subject_id', newId);
                      } catch {}
                    }}
                    className="w-full px-4 py-3 clay-input text-sm font-bold text-[#1B1640] rounded-2xl bg-white/70 appearance-none pr-10 cursor-pointer"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-[#5B5F8A]">
                    <BookOpen className="h-4 w-4" />
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs flex items-center justify-between">
                  <div>
                    <p className="font-extrabold text-amber-900">Add a subject first</p>
                    <p className="text-amber-700 font-semibold mt-0.5">You need at least one subject to create a session</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenAddModal}
                    className="px-3 py-1.5 rounded-full clay-btn clay-btn-primary text-xs font-extrabold shrink-0 ml-3"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Subject
                  </button>
                </div>
              )}
            </div>

            {/* Duration selector */}
            <div>
              <label className="label-clay block mb-3">
                SESSION DURATION
              </label>

              {/* Selectable clay chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: '1 Minute', seconds: 60 },
                  { label: '5 Minutes', seconds: 300 },
                  { label: '10 Minutes', seconds: 600 }
                ].map((item) => {
                  const isSelected = !isCustom && presetSeconds === item.seconds;
                  return (
                    <button
                      key={item.seconds}
                      type="button"
                      onClick={() => {
                        setIsCustom(false);
                        setPresetSeconds(item.seconds);
                      }}
                      className={`py-3 px-3 rounded-2xl text-xs font-extrabold transition-all text-center ${
                        isSelected
                          ? 'clay-chip-pressed'
                          : 'clay-chip clay-chip-selectable clay-chip-neutral justify-center'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setIsCustom(true)}
                  className={`py-3 px-3 rounded-2xl text-xs font-extrabold transition-all text-center ${
                    isCustom
                      ? 'clay-chip-pressed'
                      : 'clay-chip clay-chip-selectable clay-chip-neutral justify-center'
                  }`}
                >
                  Custom
                </button>
              </div>

              {/* Custom mm:ss as clay-inputs */}
              {isCustom && (
                <div className="mt-5 p-4 rounded-2xl bg-white/50 border border-white/60 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="label-clay block mb-1">
                        min
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={180}
                        step={1}
                        inputMode="numeric"
                        placeholder="15"
                        value={customMin}
                        onChange={(e) => setCustomMin(e.target.value)}
                        className="w-full px-3 py-2.5 clay-input text-sm font-mono text-center font-bold"
                      />
                    </div>
                    <span className="text-xl font-black text-[#5B5F8A] mt-5">:</span>
                    <div className="flex-1">
                      <label className="label-clay block mb-1">
                        sec
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        inputMode="numeric"
                        placeholder="30"
                        value={customSec}
                        onChange={(e) => setCustomSec(e.target.value)}
                        className="w-full px-3 py-2.5 clay-input text-sm font-mono text-center font-bold"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-[#5B5F8A] font-semibold">
                    Session length: <span className="font-extrabold text-[#1B1640]">{formatLivePreview(minVal, secVal)}</span>
                  </p>

                  {isCustomInvalid && (
                    <p className="text-xs text-[#F43F5E] font-bold">
                      Enter 15 seconds to 180 minutes
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Laptop Location Locked Panel */}
            <div className="p-4 rounded-2xl bg-white/80 border border-slate-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1B1640] flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-[#5B4BF0]" />
                  Laptop Location
                </span>
                {trackerState.isLocked && lockedReading && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </div>

              {!trackerState.isLocked || !lockedReading ? (
                <div className="space-y-2">
                  {trackerState.error || trackerState.permissionDenied || trackerState.timeoutOccurred ? (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
                      <span>{trackerState.error || 'Unable to capture laptop location.'}</span>
                      <button
                        type="button"
                        onClick={() => laptopTracker.relock()}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold text-[11px] hover:bg-rose-700 ml-2 shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-[#5B6190] py-1">
                      <RefreshCw className="h-4 w-4 text-[#5B4BF0] animate-spin" />
                      <span className="font-semibold">Locating laptop...</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[#1B1640]">
                  <p className="font-semibold text-[#1B1640]">
                    Laptop location locked: {lockedReading.lat.toFixed(6)}, {lockedReading.lng.toFixed(6)}
                  </p>
                </div>
              )}
            </div>

            {/* Big primary Start Session */}
            <button
              onClick={handleCreateSession}
              disabled={loading || isCustomInvalid || !trackerState.isLocked || !lockedReading || subjects.length === 0 || !selectedSubjectId}
              className="w-full py-4 px-6 clay-btn clay-btn-primary text-base font-extrabold rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="h-5 w-5 mr-2 fill-current" />
              {loading ? 'Creating session...' : 'Start Session'}
            </button>
          </div>

          {/* Right Column: My Subjects Card */}
          <div className="lg:col-span-5 clay-card p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200/60">
              <div>
                <h3 className="text-lg font-extrabold text-[#1B1640] tracking-tight">My Subjects</h3>
                <p className="text-xs font-semibold text-[#5B5F8A] mt-0.5">Manage your courses & sessions</p>
              </div>
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="px-3.5 py-2 rounded-full clay-btn clay-btn-primary text-xs font-extrabold flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Subject
              </button>
            </div>

            {/* Subject List */}
            <div className="space-y-3">
              {subjects.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#5B5F8A] font-semibold space-y-2">
                  <BookOpen className="h-8 w-8 mx-auto text-[#5B4BF0]/40" />
                  <p>No subjects added yet.</p>
                  <p className="text-[11px] text-[#5B5F8A]/80">Click "Add Subject" above to create your first subject.</p>
                </div>
              ) : (
                subjects.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-4 rounded-2xl clay-card-flat flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="clay-chip clay-chip-pressed text-[10px] font-mono font-black">
                          {sub.code}
                        </span>
                        <span className="text-[11px] font-bold text-[#5B5F8A]">
                          {sub.session_count} {sub.session_count === 1 ? 'session' : 'sessions'}
                        </span>
                      </div>
                      <p className="text-sm font-extrabold text-[#1B1640] truncate">
                        {sub.name}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => navigate(`/subjects/${sub.id}/history`)}
                        className="px-2.5 py-1.5 rounded-full clay-chip clay-chip-selectable text-[11px] font-bold text-[#5B4BF0]"
                        title="View history"
                      >
                        History
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenRenameModal(sub)}
                        className="p-1.5 rounded-full hover:bg-slate-200/60 text-[#5B5F8A] hover:text-[#1B1640] transition-colors"
                        title="Rename subject"
                        aria-label={`Rename ${sub.code}`}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDeleteModal(sub)}
                        className="p-1.5 rounded-full hover:bg-rose-100 text-[#5B5F8A] hover:text-[#F43F5E] transition-colors"
                        title="Delete subject"
                        aria-label={`Delete ${sub.code}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Add Subject Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="clay-card max-w-md w-full p-6 sm:p-8 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/60">
              <div>
                <h3 className="text-lg font-extrabold text-[#1B1640]">Add Subject</h3>
                <p className="text-xs font-semibold text-[#5B5F8A] mt-0.5">Enter subject code and name</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {addError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAddSubject} className="space-y-4">
              <div>
                <label className="label-clay block mb-1.5">
                  SUBJECT CODE
                </label>
                <input
                  type="text"
                  maxLength={12}
                  placeholder="e.g. DAA, CS201"
                  value={addCode}
                  onChange={(e) => {
                    setAddCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                    setAddError('');
                  }}
                  className="w-full px-4 py-2.5 clay-input text-sm font-mono font-bold uppercase"
                  autoFocus
                />
                <p className="text-[11px] font-semibold text-[#5B5F8A] mt-1">2-12 letters and digits only</p>
              </div>

              <div>
                <label className="label-clay block mb-1.5">
                  SUBJECT NAME
                </label>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="e.g. Design & Analysis of Algorithms"
                  value={addName}
                  onChange={(e) => {
                    setAddName(e.target.value);
                    setAddError('');
                  }}
                  className="w-full px-4 py-2.5 clay-input text-sm font-bold"
                />
                <p className="text-[11px] font-semibold text-[#5B5F8A] mt-1">2-80 characters</p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 clay-btn clay-btn-secondary text-xs rounded-full font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding}
                  className="px-5 py-2 clay-btn clay-btn-primary text-xs rounded-full font-extrabold disabled:opacity-50"
                >
                  {isAdding ? 'Adding...' : 'Add Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Subject Modal */}
      {editingSubject && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="clay-card max-w-md w-full p-6 sm:p-8 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/60">
              <div>
                <h3 className="text-lg font-extrabold text-[#1B1640]">Rename Subject</h3>
                <p className="text-xs font-semibold text-[#5B5F8A] mt-0.5">{editingSubject.code}</p>
              </div>
              <button
                onClick={() => setEditingSubject(null)}
                className="p-1.5 rounded-full hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitRenameSubject} className="space-y-4">
              <div>
                <label className="label-clay block mb-1.5">
                  NEW SUBJECT NAME
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setEditError('');
                  }}
                  className="w-full px-4 py-2.5 clay-input text-sm font-bold"
                  autoFocus
                />
                <p className="text-[11px] font-semibold text-[#5B5F8A] mt-1">2-80 characters</p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSubject(null)}
                  className="px-4 py-2 clay-btn clay-btn-secondary text-xs rounded-full font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="px-5 py-2 clay-btn clay-btn-primary text-xs rounded-full font-extrabold disabled:opacity-50"
                >
                  {isEditing ? 'Saving...' : 'Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Subject Confirmation Modal */}
      {deletingSubject && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="clay-card max-w-md w-full p-6 sm:p-8 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-[#1B1640]">
                    {deletingSubject.session_count === 0 ? `Delete ${deletingSubject.code}?` : `Delete ${deletingSubject.code}`}
                  </h3>
                  <p className="text-xs font-semibold text-[#5B5F8A]">{deletingSubject.name}</p>
                </div>
              </div>
              <button
                onClick={() => setDeletingSubject(null)}
                className="p-1.5 rounded-full hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{deleteError}</span>
              </div>
            )}

            {deletingSubject.session_count > 0 ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
                  <p className="font-extrabold">
                    This permanently deletes {deletingSubject.session_count} {deletingSubject.session_count === 1 ? 'session' : 'sessions'} and all attendance records for {deletingSubject.code}. Students will lose this subject.
                  </p>
                </div>

                <div>
                  <label className="label-clay block mb-1.5">
                    TYPE <span className="font-mono text-rose-600">{deletingSubject.code}</span> TO CONFIRM
                  </label>
                  <input
                    type="text"
                    placeholder={`Type ${deletingSubject.code}`}
                    value={deleteConfirmCode}
                    onChange={(e) => {
                      setDeleteConfirmCode(e.target.value);
                      setDeleteError('');
                    }}
                    className="w-full px-4 py-2.5 clay-input text-sm font-mono font-bold uppercase"
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs font-semibold text-[#5B5F8A]">
                Are you sure you want to delete this subject? It has no recorded sessions.
              </p>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingSubject(null)}
                className="px-4 py-2 clay-btn clay-btn-secondary text-xs rounded-full font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSubject}
                disabled={
                  isDeleting ||
                  (deletingSubject.session_count > 0 &&
                    deleteConfirmCode.trim().toUpperCase() !== deletingSubject.code.toUpperCase())
                }
                className="px-5 py-2 clay-btn clay-btn-danger text-xs rounded-full font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
