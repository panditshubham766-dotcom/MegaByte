import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, X, ArrowLeft, RefreshCw } from 'lucide-react';

interface PendingSubmission {
  record_id: string;
  name: string;
  student_id: string;
  photo_base64: string;
  status: string;
  face_match_score?: number | null;
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

    const interval = setInterval(() => {
      fetchSession();
      fetchPending();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchSession, fetchPending]);

  // Tick every second to update active countdown display
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
        // If it fails, we fetch the list again to restore the UI state
        fetchPending();
      }
    } catch (err) {
      console.error('Error reviewing submission:', err);
      fetchPending();
    }
  };

  const renderStatusChip = () => {
    if (!sessionInfo) return null;
    if (sessionInfo.status === 'ACTIVE') {
      const estimatedServerNow = Date.now() + serverOffsetRef.current;
      const remainingSec = Math.max(0, Math.floor((new Date(sessionInfo.expires_at).getTime() - estimatedServerNow) / 1000));
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      return (
        <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 border border-green-300 flex items-center">
          <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>
          ACTIVE • {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
        </span>
      );
    }
    if (sessionInfo.status === 'EXPIRED') {
      return (
        <span className="px-3 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 border border-red-300">
          EXPIRED (Time up)
        </span>
      );
    }
    return (
      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-200 text-gray-800 border border-gray-300">
        ENDED (Faculty)
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate(`/session/${currentSessionId}`)}
              className="p-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-600"
              title="Back to Session Code"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Live Review Dashboard</h1>
            {renderStatusChip()}
          </div>
          <div className="flex items-center text-gray-500 text-sm bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200">
            <RefreshCw className="h-4 w-4 mr-2 animate-spin-slow" />
            Live Polling Active
          </div>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-6">
            {error}
          </div>
        )}

        {loading && submissions.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            <div className="mx-auto w-24 h-24 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <Check className="h-10 w-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-medium text-gray-900 mb-1">All caught up!</h3>
            <p>Waiting for new student submissions...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {submissions.map((sub) => (
              <div key={sub.record_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-gray-100 w-full relative">
                  {sub.photo_base64 ? (
                    <img 
                      src={sub.photo_base64} 
                      alt={`Photo of ${sub.name}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      No Photo
                    </div>
                  )}
                  {sub.face_match_score !== undefined && sub.face_match_score !== null && (
                    <div className="absolute top-2 right-2 bg-black/75 backdrop-blur-sm text-white px-2.5 py-1 rounded-md text-xs font-semibold shadow">
                      Match {Math.round(sub.face_match_score * 100)}%
                    </div>
                  )}
                </div>
                <div className="p-4 flex-grow flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="min-w-0">
                      <h3 className="font-bold text-lg text-gray-900 truncate">{sub.name}</h3>
                      <p className="text-sm text-gray-500 truncate">{sub.student_id || 'No ID Provided'}</p>
                    </div>
                    {sub.face_match_score !== undefined && sub.face_match_score !== null && (
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                        Match {Math.round(sub.face_match_score * 100)}%
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <button
                      onClick={() => handleReview(sub.record_id, 'REJECTED')}
                      className="flex items-center justify-center py-2 px-3 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium text-sm"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleReview(sub.record_id, 'APPROVED')}
                      className="flex items-center justify-center py-2 px-3 border border-transparent text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors font-medium text-sm shadow-sm"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
