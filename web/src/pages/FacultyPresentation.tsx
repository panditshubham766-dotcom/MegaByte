import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, StopCircle, RefreshCw } from 'lucide-react';

interface SessionData {
  id: string;
  random_code: string;
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  expires_at: string;
  ended_at?: string | null;
  server_now: string;
}

export default function FacultyPresentation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isEnding, setIsEnding] = useState(false);

  // Store server clock offset: serverTime - clientLocalTime
  const serverOffsetRef = useRef<number>(0);

  const fetchSession = useCallback(async () => {
    if (!id) return;
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Session not found');
        } else if (response.status === 403) {
          throw new Error('Unauthorized to view this session');
        } else {
          throw new Error('Failed to load session');
        }
      }

      const data: SessionData = await response.json();
      setSession(data);
      setError('');

      // Calculate server clock offset
      const serverTimeMs = new Date(data.server_now).getTime();
      const clientTimeMs = Date.now();
      serverOffsetRef.current = serverTimeMs - clientTimeMs;

      return data;
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!session || session.status !== 'ACTIVE') {
      setTimeLeft(0);
      return;
    }

    const calculateTimeLeft = () => {
      const estimatedServerNow = Date.now() + serverOffsetRef.current;
      const targetTime = new Date(session.expires_at).getTime();
      const differenceSec = Math.floor((targetTime - estimatedServerNow) / 1000);

      if (differenceSec <= 0) {
        setTimeLeft(0);
        fetchSession(); // Refetch to transition state to EXPIRED on server
      } else {
        setTimeLeft(differenceSec);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [session, fetchSession]);

  const handleEndSession = async () => {
    if (!id) return;
    const confirmEnd = window.confirm('Are you sure you want to end this attendance session?');
    if (!confirmEnd) return;

    setIsEnding(true);
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/sessions/${id}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to end session');
      }

      const data: SessionData = await response.json();
      setSession(data);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Could not end session');
    } finally {
      setIsEnding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 text-white">
        <RefreshCw className="h-10 w-10 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-400">Loading session...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 text-white text-center">
        <div className="bg-red-950 border border-red-500 rounded-2xl p-8 max-w-md w-full">
          <h2 className="text-2xl font-bold text-red-400 mb-2">Error</h2>
          <p className="text-gray-300 mb-6">{error || 'Session not found'}</p>
          <button
            onClick={() => navigate('/faculty/dashboard')}
            className="px-6 py-2 bg-white text-black font-semibold rounded-full hover:bg-gray-200 transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isOver = session.status !== 'ACTIVE';

  const codeChars = (session.random_code || '').slice(0, 6).split('');

  return (
    <div className="min-h-screen md:h-screen md:max-h-screen md:overflow-hidden bg-black flex flex-col items-center justify-center p-4 md:p-6 relative select-none">
      <div className="absolute top-6 left-6">
        <button
          onClick={() => navigate('/faculty/dashboard')}
          className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>Dashboard</span>
        </button>
      </div>

      <div className="text-center w-full max-w-4xl my-auto">
        <h1 className="text-2xl md:text-4xl text-gray-400 mb-4 md:mb-6 tracking-wider uppercase">
          Attendance Code
        </h1>

        <div className="grid grid-cols-6 gap-2 sm:gap-3 md:gap-4 w-full mb-6 max-w-3xl mx-auto">
          {codeChars.map((char, index) => (
            <div
              key={index}
              className={`aspect-square flex items-center justify-center rounded-2xl md:rounded-3xl border-2 font-mono font-bold shadow-2xl transition-all ${
                isOver
                  ? 'bg-gray-900 border-gray-700 text-gray-500'
                  : 'bg-gray-900 border-green-500 text-green-400 shadow-[0_0_30px_rgba(34,197,94,0.25)]'
              }`}
              style={{ fontSize: 'clamp(2.5rem, 10vw, 8rem)' }}
            >
              {char}
            </div>
          ))}
        </div>

        {!isOver ? (
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="text-gray-400 text-xl uppercase tracking-widest">
              Time Remaining
            </div>
            <div className={`text-6xl md:text-8xl font-mono font-bold tabular-nums ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
              {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
              <button
                onClick={() => navigate(`/session/${session.id}/review`)}
                className="px-8 py-3 bg-blue-600/20 border border-blue-500 text-blue-400 font-bold rounded-full text-lg hover:bg-blue-600 hover:text-white transition-colors"
              >
                Live Review
              </button>
              <button
                onClick={handleEndSession}
                disabled={isEnding}
                className="flex items-center px-8 py-3 bg-red-600/20 border border-red-500 text-red-400 font-bold rounded-full text-lg hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50"
              >
                <StopCircle className="h-5 w-5 mr-2" />
                {isEnding ? 'Ending...' : 'End Session'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center justify-center space-y-6">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl py-4 px-8 text-center">
              <p className="text-xl md:text-2xl font-bold text-red-400 mb-1">
                Session ended
              </p>
              <p className="text-gray-400 text-sm">
                {session.status === 'EXPIRED'
                  ? 'Time limit expired'
                  : 'Ended by faculty'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
              <button
                onClick={() => navigate(`/session/${session.id}/review`)}
                className="px-8 py-4 bg-blue-600 text-white font-bold rounded-full text-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-900/50"
              >
                Live Review
              </button>
              <button
                onClick={() => navigate('/faculty/dashboard')}
                className="px-8 py-4 bg-white text-black font-bold rounded-full text-xl hover:bg-gray-200 transition-colors"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
