import { useNavigate } from 'react-router-dom';
import { Camera, CalendarCheck } from 'lucide-react';

interface BottomNavProps {
  activeTab: 'verify' | 'records';
  onNavigate?: () => void;
}

export default function BottomNav({ activeTab, onNavigate }: BottomNavProps) {
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-3 inset-x-0 z-40 px-4 pb-[env(safe-area-inset-bottom,0px)] pointer-events-none">
      <div className="max-w-[340px] mx-auto clay-bottombar px-2.5 py-1.5 grid grid-cols-2 gap-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            if (activeTab !== 'verify') {
              onNavigate?.();
              navigate('/capture');
            }
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-full transition-all ${
            activeTab === 'verify'
              ? 'clay-chip-pressed text-white font-extrabold'
              : 'text-[#5B6190] hover:text-[#1B1640] font-bold'
          }`}
          aria-label="Verify Attendance"
        >
          <Camera className="h-5 w-5" />
          <span className="text-[10px] uppercase tracking-wider">Verify</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeTab !== 'records') {
              onNavigate?.();
              navigate('/my-attendance');
            }
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-full transition-all ${
            activeTab === 'records'
              ? 'clay-chip-pressed text-white font-extrabold'
              : 'text-[#5B6190] hover:text-[#1B1640] font-bold'
          }`}
          aria-label="Attendance Records"
        >
          <CalendarCheck className="h-5 w-5" />
          <span className="text-[10px] uppercase tracking-wider">Records</span>
        </button>
      </div>
    </nav>
  );
}
