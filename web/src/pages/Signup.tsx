import { useState, useRef, useEffect } from 'react';
import type { FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectName, setSubjectName] = useState('');

  const [showPassword, setShowPassword] = useState(false);
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
      setError('Please enter your faculty college email first.');
      return;
    }

    setSendingOtp(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'signup', role: 'faculty' }),
      });

      const data = await response.json();
      setCountdown(60);
      setSuccessMsg(data.message || 'If this email can be used, a code has been sent.');
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code.');
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

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/auth/signup/faculty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          inviteCode,
          subjectCode,
          subjectName,
          code: fullCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed.');
      }

      // On success navigate to login with email prefilled
      navigate('/login', { state: { email } });
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="rounded-full bg-blue-100 p-3">
            <UserPlus className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Faculty Registration
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Create a new faculty account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Email + Send Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Faculty College Email</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="name@iiitdwd.ac.in"
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sendingOtp || countdown > 0}
                  className="whitespace-nowrap px-3 py-2 border border-transparent rounded-md shadow-sm text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {countdown > 0 ? `${countdown}s` : sendingOtp ? 'Sending...' : 'Send code'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">Hint: Check Spam too</p>
            </div>

            {/* 6-box OTP Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 text-center mb-1.5">
                6-Digit Verification Code
              </label>
              <div className="flex justify-between gap-1.5 sm:gap-2 max-w-[300px] mx-auto">
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
                    className="w-10 h-12 sm:w-11 sm:h-13 text-center font-mono text-xl font-bold uppercase rounded-xl border border-gray-300 bg-white text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 shadow-xs transition-all"
                    aria-label={`Digit ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Full Name</label>
              <div className="mt-1">
                <input
                  type="text"
                  required
                  placeholder="Dr. Alan Turing"
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <div className="mt-1 relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Min 8 chars, letter & number"
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
              <div className="mt-1 relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter password"
                  className="appearance-none block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Invite Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Faculty Invite Code</label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  placeholder="Enter faculty invite code"
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
            </div>

            {/* Subject Code & Subject Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Subject Code</label>
                <div className="mt-1">
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS101"
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm uppercase"
                    value={subjectCode}
                    onChange={(e) => setSubjectCode(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Subject Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    required
                    placeholder="e.g. Computer Science"
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Creating account...' : 'Sign up'}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center border-t border-gray-200 pt-4">
            <Link
              to="/login"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
