import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Clock, Play, History, X } from 'lucide-react';

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

      // Navigate to code presentation view with session id
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Faculty Dashboard</h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={handleSubjectHistory}
              className="flex items-center text-sm font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors"
              title="View Subject Attendance Matrix"
            >
              <History className="h-4 w-4 mr-1.5" />
              Subject history
            </button>
            <span className="text-gray-600">{user.name}</span>
            <button
              onClick={handleLogout}
              className="flex items-center text-gray-500 hover:text-gray-700"
            >
              <LogOut className="h-5 w-5 mr-1" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="bg-white rounded-lg shadow p-6 max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold mb-6">Create Attendance Session</h2>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Clock className="h-4 w-4 mr-2" />
                Session Duration
              </label>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: '1 Minute', seconds: 60 },
                  { label: '5 Minutes', seconds: 300 },
                  { label: '10 Minutes', seconds: 600 }
                ].map((item) => (
                  <button
                    key={item.seconds}
                    type="button"
                    onClick={() => {
                      setIsCustom(false);
                      setPresetSeconds(item.seconds);
                    }}
                    className={`py-2 px-4 border rounded-md text-sm font-medium ${
                      !isCustom && presetSeconds === item.seconds
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsCustom(true)}
                  className={`py-2 px-4 border rounded-md text-sm font-medium ${
                    isCustom
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Custom
                </button>
              </div>

              {isCustom && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono text-center"
                      />
                    </div>
                    <span className="text-xl font-bold text-gray-400 mt-5">:</span>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono text-center"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 font-medium">
                    Session length: {formatLivePreview(minVal, secVal)}
                  </p>

                  {isCustomInvalid && (
                    <p className="text-xs text-red-600 font-medium">
                      Enter 15 seconds to 180 minutes
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleCreateSession}
              disabled={loading || isCustomInvalid}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <Play className="h-5 w-5 mr-2" />
              {loading ? 'Creating...' : 'Start Session'}
            </button>
          </div>
        </div>
      </main>

      {/* Multi-subject picker modal */}
      {showSubjectPicker && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Select Subject History</h3>
              <button
                onClick={() => setShowSubjectPicker(false)}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setShowSubjectPicker(false);
                    navigate(`/subjects/${s.id}/history`);
                  }}
                  className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50/50 transition-all flex items-center justify-between group"
                >
                  <div>
                    <span className="text-xs font-bold text-blue-600 uppercase">{s.code}</span>
                    <p className="font-semibold text-gray-900">{s.name}</p>
                  </div>
                  <span className="text-xs text-blue-600 font-semibold group-hover:translate-x-0.5 transition-transform">
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
