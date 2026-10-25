import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Clock, Play, History, X, MapPin, Plus } from 'lucide-react';

export default function FacultyDashboard() {
  const [presetSeconds, setPresetSeconds] = useState(300);
  const [isCustom, setIsCustom] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customSec, setCustomSec] = useState('');
  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [classrooms, setClassrooms] = useState<{
    id: string;
    name: string;
    building: string | null;
    latitude: number;
    longitude: number;
    radius_meters: number;
    max_accuracy_meters: number;
    verification_policy?: 'GPS_ONLY' | 'WIFI_ONLY' | 'GPS_OR_WIFI' | 'GPS_AND_WIFI';
  }[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>('');
  const [showAddClassroomModal, setShowAddClassroomModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBuilding, setNewBuilding] = useState('');
  const [newLat, setNewLat] = useState('');
  const [newLon, setNewLon] = useState('');
  const [newRadius, setNewRadius] = useState('100');
  const [newAccuracy, setNewAccuracy] = useState('30');
  const [newPolicy, setNewPolicy] = useState<'GPS_ONLY' | 'WIFI_ONLY' | 'GPS_OR_WIFI' | 'GPS_AND_WIFI'>('GPS_ONLY');
  const [newBssid, setNewBssid] = useState('');
  const [newSsid, setNewSsid] = useState('');
  const [savingClassroom, setSavingClassroom] = useState(false);
  const [locatingDevice, setLocatingDevice] = useState(false);
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

    const fetchClassrooms = async () => {
      try {
        const token = localStorage.getItem('token');
        const API_URL = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${API_URL}/api/classrooms`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setClassrooms(data);
        }
      } catch (e) {
        console.error('Error fetching classrooms:', e);
      }
    };

    checkActiveSession();
    fetchSubjects();
    fetchClassrooms();
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

  const handleGetCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setLocatingDevice(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNewLat(pos.coords.latitude.toFixed(6));
        setNewLon(pos.coords.longitude.toFixed(6));
        if (pos.coords.accuracy) {
          setNewAccuracy(Math.min(50, Math.max(10, Math.round(pos.coords.accuracy))).toString());
        }
        setLocatingDevice(false);
      },
      (err) => {
        alert(`Could not fetch device location: ${err.message}`);
        setLocatingDevice(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newLat || !newLon) {
      alert('Please enter Classroom Name, Latitude, and Longitude');
      return;
    }
    const lat = parseFloat(newLat);
    const lon = parseFloat(newLon);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      alert('Latitude must be between -90 and 90');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      alert('Longitude must be between -180 and 180');
      return;
    }

    setSavingClassroom(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/classrooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newName.trim(),
          building: newBuilding.trim() || null,
          latitude: lat,
          longitude: lon,
          radius_meters: parseInt(newRadius, 10) || 100,
          max_accuracy_meters: parseInt(newAccuracy, 10) || 30,
          verification_policy: newPolicy,
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create classroom');
      }

      // If BSSID provided, register approved access point
      if (newBssid.trim()) {
        try {
          await fetch(`${API_URL}/api/classrooms/${data.id}/access-points`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              bssid: newBssid.trim(),
              ssid: newSsid.trim() || null,
              description: 'Primary classroom AP',
            })
          });
        } catch (apErr) {
          console.warn('Could not register initial AP:', apErr);
        }
      }

      setClassrooms((prev) => [...prev, data]);
      setSelectedClassroomId(data.id);
      setShowAddClassroomModal(false);
      setNewName('');
      setNewBuilding('');
      setNewLat('');
      setNewLon('');
      setNewRadius('100');
      setNewAccuracy('30');
      setNewPolicy('GPS_ONLY');
      setNewBssid('');
      setNewSsid('');
    } catch (err: any) {
      alert(err.message || 'Failed to save classroom');
    } finally {
      setSavingClassroom(false);
    }
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
        body: JSON.stringify({
          durationSeconds: chosenSeconds,
          classroom_id: selectedClassroomId || null,
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

            {/* Classroom Geofencing Configuration */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 flex items-center">
                  <MapPin className="h-4 w-4 mr-2 text-indigo-600" />
                  Classroom Geofence
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddClassroomModal(true)}
                  className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Classroom
                </button>
              </div>

              <select
                value={selectedClassroomId}
                onChange={(e) => setSelectedClassroomId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-gray-800"
              >
                <option value="">No Classroom Geofence (Remote / Disabled)</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.building ? `(${c.building})` : ''} - [{c.verification_policy || 'GPS_ONLY'}] Radius: {c.radius_meters}m
                  </option>
                ))}
              </select>

              {selectedClassroomId && (
                <div className="mt-2.5 p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-lg text-xs text-indigo-900 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-indigo-950">
                      Presence Policy: {classrooms.find((c) => c.id === selectedClassroomId)?.verification_policy || 'GPS_ONLY'}
                    </span>
                    <p className="text-indigo-700">
                      Geofence: ≤{classrooms.find((c) => c.id === selectedClassroomId)?.radius_meters}m radius, GPS accuracy ≤{classrooms.find((c) => c.id === selectedClassroomId)?.max_accuracy_meters}m.
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-bold rounded text-[11px] uppercase tracking-wide">
                    Enforced
                  </span>
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
      {/* Add Classroom Modal */}
      {showAddClassroomModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-gray-900">Add Physical Classroom</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddClassroomModal(false)}
                className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClassroom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Classroom Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lecture Hall 101"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Building / Block (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Science Block C"
                  value={newBuilding}
                  onChange={(e) => setNewBuilding(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">GPS Coordinates (WGS-84)</span>
                  <button
                    type="button"
                    onClick={handleGetCurrentLocation}
                    disabled={locatingDevice}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    {locatingDevice ? 'Acquiring GPS...' : '📍 Use Current Device Location'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-0.5">
                      Latitude (-90 to 90) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="12.971598"
                      value={newLat}
                      onChange={(e) => setNewLat(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-0.5">
                      Longitude (-180 to 180) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="77.594566"
                      value={newLon}
                      onChange={(e) => setNewLon(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Geofence Radius (meters)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={newRadius}
                    onChange={(e) => setNewRadius(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm font-mono"
                  />
                  <span className="text-[10px] text-gray-500">Default: 100 meters</span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Max GPS Accuracy (meters)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={newAccuracy}
                    onChange={(e) => setNewAccuracy(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm font-mono"
                  />
                  <span className="text-[10px] text-gray-500">Default: 30 meters</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Presence Verification Policy
                </label>
                <select
                  value={newPolicy}
                  onChange={(e) => setNewPolicy(e.target.value as any)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md sm:text-sm bg-white"
                >
                  <option value="GPS_ONLY">GPS Geofencing Only (Standard)</option>
                  <option value="GPS_OR_WIFI">GPS Geofence OR Approved Wi-Fi (Recommended for indoor reliability)</option>
                  <option value="GPS_AND_WIFI">Both GPS AND Approved Wi-Fi Required (High security)</option>
                  <option value="WIFI_ONLY">Approved Wi-Fi AP Only (e.g. Basements without GPS reception)</option>
                </select>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <span className="text-xs font-bold text-slate-700">Optional: Register Approved Wi-Fi Access Point</span>
                <p className="text-[11px] text-slate-500">Never store or expose router passwords. Register radio hardware BSSIDs.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-0.5">BSSID (MAC Address)</label>
                    <input
                      type="text"
                      placeholder="e.g. 00:14:22:01:23:45"
                      value={newBssid}
                      onChange={(e) => setNewBssid(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-0.5">SSID Network Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Campus-Secure"
                      value={newSsid}
                      onChange={(e) => setNewSsid(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddClassroomModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClassroom}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {savingClassroom ? 'Saving...' : 'Save Classroom'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
