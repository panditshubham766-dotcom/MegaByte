import { useState, useRef, useEffect } from 'react';
import type { FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendOtp = async () => {
    setError('');
    setSuccessMsg('');
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }

    setSendingOtp(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'reset' }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to request reset code.');
      }

      setCountdown(60);
      setSuccessMsg(data.message || 'If this email can be used, a code has been sent.');
    } catch (err: any) {
      setError(err.message || 'Failed to request reset code.');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) {
      const newDigits = [...codeDigits];
      newDigits[index] = '';
      setCodeDigits(newDigits);
      return;
    }

    if (cleaned.length > 1) {
      const newDigits = [...codeDigits];
      for (let i = 0; i < cleaned.length && index + i < 6; i++) {
        newDigits[index + i] = cleaned[i];
      }
      setCodeDigits(newDigits);
      const nextFocus = Math.min(index + cleaned.length, 5);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    const newDigits = [...codeDigits];
    newDigits[index] = cleaned[0];
    setCodeDigits(newDigits);

    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!codeDigits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...codeDigits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setCodeDigits(newDigits);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const fullCode = codeDigits.join('');
    if (fullCode.length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code: fullCode,
          newPassword,
        }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Password reset failed.');
      }

      setSuccessMsg('Password reset successfully! Redirecting to login...');
      setTimeout(() => {
        navigate('/login', { state: { email } });
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-4 py-8 safe-pt safe-pb">
      <div className="w-full max-w-[360px] mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center flex flex-col items-center">
          <div className="w-14 h-14 bg-[#0F172A] text-white font-black text-2xl rounded-2xl flex items-center justify-center shadow-sm select-none">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-[#0F172A] mt-3">
            Reset Password
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Student Portal • Password Recovery
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.05)]">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-3.5 py-3 rounded-xl text-xs font-medium flex items-start gap-2 shadow-xs">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-3.5 py-3 rounded-xl text-xs font-medium flex items-start gap-2 shadow-xs">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-green-500" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Email + Send Code */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Email address
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="23bcs001@iiitdwd.ac.in"
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400 transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sendingOtp || countdown > 0}
                  className="whitespace-nowrap px-3 h-11 bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
                >
                  {countdown > 0 ? `${countdown}s` : sendingOtp ? 'Sending...' : 'Send code'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Hint: Check Spam too</p>
            </div>

            {/* 6-box OTP input */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 text-center mb-1.5">
                6-Digit Verification Code
              </label>
              <div className="flex justify-between gap-1 sm:gap-1.5 max-w-[280px] mx-auto">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    maxLength={1}
                    autoComplete="off"
                    spellCheck={false}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    onPaste={handlePaste}
                    className="w-10 h-12 text-center font-mono text-xl font-bold uppercase rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 shadow-xs transition-all"
                    aria-label={`Digit ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  placeholder="Min 8 chars, letter & number"
                  className="w-full h-11 pl-3.5 pr-11 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400 transition-all"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter new password"
                  className="w-full h-11 pl-3.5 pr-11 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400 transition-all"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 min-h-[44px] flex items-center justify-center bg-[#0F172A] hover:bg-[#1E293B] active:scale-[0.99] text-white text-sm font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Resetting password...' : 'Reset Password'}
              </button>
            </div>
          </form>

          <div className="mt-5 text-center border-t border-slate-100 pt-4">
            <Link
              to="/login"
              className="text-xs font-semibold text-blue-600 hover:text-blue-500"
            >
              Back to Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
