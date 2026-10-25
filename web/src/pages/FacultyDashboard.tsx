import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Play, History, X } from 'lucide-react';

export default function FacultyDashboard() {
  const [presetSeconds, setPresetSeconds] = useState(300);
  const [isCustom, setIsCustom] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customSec, setCustomSec] = useState('');
  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const navigate = useNavigate();

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
          const data = await response.json();
          setSubjects(data);
        }
      } catch (e) {
        console.error('Error fetching subjects:', e);
      }
    };

    checkActiveSession();
    fetchSubjects();
  }, [navigate]);

  const handleSubjectHistory = () => {
    if (subjects.length === 1) {
      navigate(`/subjects/${subjects[0].id}/history`);
    } else if (subjects.length > 1) {
      setShowSubjectPicker(true);
    } else {
      alert('No subjects found for this faculty.');
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
        body: JSON.stringify({ durationSeconds: chosenSeconds })
      });

      const data = await response.json();
      if (response.status === 409 && data.sessionId) {
        navigate(`/session/${data.sessionId}`);
        return;
      }
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create session');
      }

      navigate(`/session/${data.id}`);
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Failed to create session. Check console.');
    } finally {
      setLoading(false);
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

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto flex flex-col justify-center">
        <div className="clay-card p-6 sm:p-10 max-w-xl w-full mx-auto">
          <div className="mb-6 text-center sm:text-left">
            <h2 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">Create Attendance Session</h2>
            <p className="text-xs font-semibold text-[#5B5F8A] mt-1">Configure session length and display code for students</p>
          </div>

          <div className="space-y-6">
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

            {/* Big primary Start Session */}
            <button
              onClick={handleCreateSession}
              disabled={loading || isCustomInvalid}
              className="w-full py-4 px-6 clay-btn clay-btn-primary text-base font-extrabold rounded-full"
            >
              <Play className="h-5 w-5 mr-2 fill-current" />
              {loading ? 'Creating session...' : 'Start Session'}
            </button>
          </div>
        </div>
      </main>

      {/* Multi-subject picker modal */}
      {showSubjectPicker && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="clay-card max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-[#1B1640]">Select Subject History</h3>
                <p className="text-xs font-semibold text-[#5B5F8A]">Choose a subject to view attendance records</p>
              </div>
              <button
                onClick={() => setShowSubjectPicker(false)}
                className="p-1.5 rounded-full hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2.5">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setShowSubjectPicker(false);
                    navigate(`/subjects/${s.id}/history`);
                  }}
                  className="w-full text-left p-4 rounded-2xl clay-card-flat hover:scale-[1.01] transition-transform flex items-center justify-between group"
                >
                  <div>
                    <span className="clay-chip clay-chip-pressed text-[10px] mb-1">
                      {s.code}
                    </span>
                    <p className="font-extrabold text-sm text-[#1B1640] mt-1">{s.name}</p>
                  </div>
                  <span className="text-xs text-[#5B4BF0] font-extrabold group-hover:translate-x-1 transition-transform">
                    View &rarr;
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
