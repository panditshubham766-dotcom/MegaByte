import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';

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
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, portal: 'faculty' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      if (data.user.role === 'FACULTY') {
        navigate('/faculty/dashboard');
      } else {
        navigate('/student/capture');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full clay-tile text-[#5B4BF0] font-black text-2xl mb-4">
            M
          </div>
          <h1 className="text-3xl font-extrabold text-[#1B1640] tracking-tight">MegaByte</h1>
          <p className="mt-1 text-sm font-semibold text-[#5B5F8A]">Faculty Portal • Sign in to your account</p>
        </div>

        <div className="clay-card p-6 sm:p-8">
          <form className="space-y-5" onSubmit={handleLogin}>
            {error && (
              <div className="clay-chip-danger px-4 py-3 rounded-2xl text-xs font-bold w-full">
                {error}
              </div>
            )}
            <div>
              <label className="label-clay block mb-2">
                Email address
              </label>
              <input
                type="email"
                required
                placeholder="name@iiitdwd.ac.in"
                className="w-full px-4 py-3 clay-input text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label-clay block">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-bold text-[#5B4BF0] hover:opacity-80 transition-opacity"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 pr-11 clay-input text-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-6 clay-btn clay-btn-primary text-sm font-extrabold rounded-full"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center border-t border-slate-200/60 pt-4">
            <Link
              to="/signup"
              className="text-xs font-bold text-[#5B5F8A] hover:text-[#1B1640] transition-colors"
            >
              Do not have an account? <span className="text-[#5B4BF0] font-extrabold">Sign up</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
