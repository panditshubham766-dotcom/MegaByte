import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function Login() {
  const location = useLocation();
  const [email, setEmail] = useState((location.state as any)?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Get or generate a persistent device UUID for this browser/device
      let device_uuid = localStorage.getItem('device_uuid');
      if (!device_uuid) {
        device_uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
        localStorage.setItem('device_uuid', device_uuid);
      }

      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, portal: 'student', device_uuid }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      if (data.user.role === 'STUDENT') {
        navigate('/capture');
      } else {
        setError('Faculty must use the web dashboard.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col justify-center items-center px-4 py-8 safe-pt safe-pb">
      <div className="w-full max-w-[360px] mx-auto space-y-6">
        {/* Brand Logo & Heading */}
        <div className="text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl clay-tile text-[#5B4BF0] font-black text-2xl flex items-center justify-center select-none mb-1">
            M
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#1B1640] mt-2">
            MegaByte
          </h1>
          <p className="text-xs font-semibold text-[#5B6190] mt-1">
            Student Portal • Sign in
          </p>
        </div>

        {/* Login Card */}
        <div className="clay-card p-6">
          <form className="space-y-5" onSubmit={handleLogin}>
            {error && (
              <div className="clay-chip-danger px-3.5 py-3 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="label-clay block mb-1.5">
                Email address
              </label>
              <input
                type="email"
                required
                placeholder="23bcs001@iiitdwd.ac.in"
                className="w-full h-12 px-3.5 clay-input text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="label-clay block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  className="w-full h-12 pl-3.5 pr-11 clay-input text-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link
                to="/forgot-password"
                className="text-xs font-bold text-[#5B4BF0] hover:opacity-80 transition-opacity"
              >
                Forgot password?
              </Link>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 min-h-[44px] clay-btn clay-btn-primary text-sm font-extrabold rounded-full"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className="mt-5 text-center border-t border-slate-200/60 pt-4">
            <Link
              to="/signup"
              className="text-xs font-bold text-[#5B6190] hover:text-[#1B1640] transition-colors"
            >
              Do not have an account? <span className="text-[#5B4BF0] font-extrabold">Sign up</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
