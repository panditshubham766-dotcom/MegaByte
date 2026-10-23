import { useNavigate } from 'react-router-dom';
import { Camera, CalendarCheck } from 'lucide-react';

interface BottomNavProps {
  activeTab: 'verify' | 'records';
  onNavigate?: () => void;
}

export default function BottomNav({ activeTab, onNavigate }: BottomNavProps) {
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 z-40 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(0,0,0,0.03)]">
      <div className="max-w-[360px] sm:max-w-md mx-auto grid grid-cols-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            if (activeTab !== 'verify') {
              onNavigate?.();
              navigate('/capture');
            }
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-xl transition-all ${
            activeTab === 'verify'
              ? 'text-[#0F172A] font-bold'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
          aria-label="Verify Attendance"
        >
          <div className={`p-1.5 rounded-xl transition-colors ${activeTab === 'verify' ? 'bg-slate-100 text-[#0F172A]' : ''}`}>
            <Camera className="h-5 w-5" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider">Verify</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeTab !== 'records') {
              onNavigate?.();
              navigate('/my-attendance');
            }
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-xl transition-all ${
            activeTab === 'records'
              ? 'text-[#0F172A] font-bold'
              : 'text-slate-400 hover:text-slate-600 font-medium'
          }`}
          aria-label="Attendance Records"
        >
          <div className={`p-1.5 rounded-xl transition-colors ${activeTab === 'records' ? 'bg-slate-100 text-[#0F172A]' : ''}`}>
            <CalendarCheck className="h-5 w-5" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider">Records</span>
        </button>
      </div>
    </nav>
  );
}
