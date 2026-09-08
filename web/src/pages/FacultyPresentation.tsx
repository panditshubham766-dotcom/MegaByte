import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function FacultyPresentation() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = location.state?.session;
  
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!session) {
      navigate('/faculty/dashboard');
      return;
    }

    const targetTime = new Date(session.expires_at).getTime();

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetTime - now;

      if (difference <= 0) {
        clearInterval(interval);
        setTimeLeft(0);
      } else {
        setTimeLeft(Math.floor(difference / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, navigate]);

  if (!session) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="text-center w-full max-w-4xl">
        <h1 className="text-4xl md:text-6xl text-gray-400 mb-8 tracking-wider uppercase">
          Attendance Code
        </h1>
        
        <div className="bg-gray-900 border-2 border-green-500 rounded-3xl p-12 md:p-24 shadow-[0_0_50px_rgba(34,197,94,0.3)] mb-12 transform transition-all hover:scale-105">
          <div className="text-[15vw] leading-none font-mono font-bold text-green-400 tracking-[0.2em]">
            {session.random_code}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="text-gray-400 text-2xl uppercase tracking-widest">
            Time Remaining
          </div>
          <div className={`text-6xl md:text-8xl font-mono font-bold tabular-nums ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
            {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
          </div>
        </div>

        {timeLeft === 0 && (
          <div className="mt-12">
            <button
              onClick={() => navigate('/faculty/dashboard')}
              className="px-8 py-4 bg-white text-black font-bold rounded-full text-xl hover:bg-gray-200 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
