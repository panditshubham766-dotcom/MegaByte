import { useState, useRef, useEffect } from 'react';
import type { FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Camera, Eye, EyeOff, AlertCircle, Trash2, CameraOff, Sparkles } from 'lucide-react';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Subject state
  const [subjects, setSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [subjectLoadError, setSubjectLoadError] = useState('');

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isVideoReady, setIsVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navigate = useNavigate();

  // Load public subjects
  const loadSubjects = async () => {
    setLoadingSubjects(true);
    setSubjectLoadError('');
    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/subjects/public`);
      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Could not load subjects, try again');
      }
      if (!response.ok || !Array.isArray(data)) {
        throw new Error('Could not load subjects, try again');
      }
      setSubjects(data);
    } catch {
      setSubjectLoadError('Could not load subjects, try again');
    } finally {
      setLoadingSubjects(false);
    }
  };

  useEffect(() => {
    loadSubjects();
  }, []);

  // Derived roll number from email
  const derivedRollNumber = email.includes('@')
    ? email.split('@')[0].toUpperCase()
    : '';

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setIsVideoReady(false);
  };

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError('');
    setIsVideoReady(false);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err: any) {
      setCameraError('Unable to access front camera. Please grant camera permissions.');
      setCameraActive(false);
    }
  };

  // Attach stream in a useEffect after element mounts (srcObject, then await play() in try/catch)
  useEffect(() => {
    if (!cameraActive || !streamRef.current) return;

    let isSubscribed = true;
    const attachAndPlay = async () => {
      if (!videoRef.current || !streamRef.current) return;
      videoRef.current.srcObject = streamRef.current;
      try {
        await videoRef.current.play();
      } catch (err) {
        console.error('video.play() failed:', err);
      }
    };

    attachAndPlay();

    const video = videoRef.current;
    const updateReadyState = () => {
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        if (isSubscribed) setIsVideoReady(true);
      }
    };

    video?.addEventListener('loadeddata', updateReadyState);
    video?.addEventListener('canplay', updateReadyState);
    video?.addEventListener('playing', updateReadyState);
    video?.addEventListener('timeupdate', updateReadyState);

    const checkInterval = setInterval(updateReadyState, 200);

    return () => {
      isSubscribed = false;
      clearInterval(checkInterval);
      if (video) {
        video.removeEventListener('loadeddata', updateReadyState);
        video.removeEventListener('canplay', updateReadyState);
        video.removeEventListener('playing', updateReadyState);
        video.removeEventListener('timeupdate', updateReadyState);
      }
    };
  }, [cameraActive]);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || video.videoWidth <= 0) return;
    if (photos.length >= 5) {
      setError('Maximum 5 photos allowed.');
      return;
    }

    const canvas = canvasRef.current || document.createElement('canvas');

    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;

    if (width > 640) {
      height = Math.round((height * 640) / width);
      width = 640;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw raw un-mirrored frame
    ctx.drawImage(video, 0, 0, width, height);
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.8);

    setPhotos([...photos, jpegDataUrl]);
    setError('');
  };

  const removePhoto = (index: number) => {
    const updated = photos.filter((_, i) => i !== index);
    setPhotos(updated);
  };

  const handleSendOtp = async () => {
    setError('');
    if (!email) {
      setError('Please enter your college email first.');
      return;
    }

    setSendingOtp(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'signup', role: 'student' }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to send verification code.');
      }

      setCountdown(60);
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

    if (photos.length < 3 || photos.length > 5) {
      setError('Please capture between 3 and 5 reference photos.');
      return;
    }

    setLoading(true);

    try {
      const API_URL = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${API_URL}/api/auth/signup/student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          subjectCode,
          code: fullCode,
          photos,
        }),
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error('Server unreachable, please try again');
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Student registration failed.');
      }

      stopCamera();
      // On success go to /login with the email prefilled
      navigate('/login', { state: { email } });
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-4 py-8 safe-pt safe-pb">
      <canvas ref={canvasRef} className="hidden" />

      <div className="w-full max-w-[380px] mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center flex flex-col items-center">
          <div className="w-14 h-14 bg-[#0F172A] text-white font-black text-2xl rounded-2xl flex items-center justify-center shadow-sm select-none">
            M
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-[#0F172A] mt-3">
            MegaByte
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Student Portal • Sign up
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

            {/* Email + Send Code */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                College Email
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="<roll number>@iiitdwd.ac.in"
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

            {/* Derived Roll Number Read-only */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Roll Number (from email)
              </label>
              <input
                type="text"
                readOnly
                disabled
                placeholder="Derived automatically"
                value={derivedRollNumber}
                className="w-full h-11 px-3.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-600 font-mono text-sm font-semibold select-none cursor-not-allowed"
              />
            </div>

            {/* Name */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                required
                placeholder="Ada Lovelace"
                className="w-full h-11 px-3.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400 transition-all"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Min 8 chars, letter & number"
                  className="w-full h-11 pl-3.5 pr-11 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400 transition-all"
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

            {/* Confirm Password */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter password"
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

            {/* Subject Dropdown */}
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Subject
              </label>
              <select
                required
                className="w-full h-11 px-3.5 border border-slate-300 rounded-xl bg-white text-slate-900 text-sm focus:outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-slate-900/10 transition-all disabled:opacity-50"
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
              >
                <option value="" disabled>
                  {loadingSubjects ? 'Loading subjects...' : 'Select a subject'}
                </option>
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.code}>
                    {sub.code} - {sub.name}
                  </option>
                ))}
              </select>
              {subjectLoadError && (
                <p className="mt-1.5 text-xs text-red-600 font-medium">
                  {subjectLoadError}
                </p>
              )}
            </div>

            {/* Photo Step: Front Camera Only via getUserMedia, No gallery */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Reference Photos (3-5)</h4>
                  <p className="text-[10px] text-slate-500">
                    Front camera capture only • {photos.length} of 3-5 taken
                  </p>
                </div>
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>Open Camera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors"
                  >
                    <CameraOff className="h-3.5 w-3.5" />
                    <span>Close</span>
                  </button>
                )}
              </div>

              {cameraError && (
                <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
                  {cameraError}
                </div>
              )}

              {/* Persistent Camera Viewfinder & Capture Button */}
              <div
                className={
                  cameraActive
                    ? 'space-y-2'
                    : 'fixed -left-[9999px] -top-[9999px] w-[320px] pointer-events-none'
                }
              >
                <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-slate-950 border border-slate-200">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                </div>
                {cameraActive && (
                  <button
                    type="button"
                    onClick={capturePhoto}
                    disabled={!isVideoReady || photos.length >= 5}
                    className="w-full h-11 flex items-center justify-center gap-2 bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Capture Photo ({photos.length}/5)</span>
                  </button>
                )}
              </div>

              {/* Photo Thumbnails */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                  {photos.map((src, idx) => (
                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                      <img src={src} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 bg-red-600/90 hover:bg-red-700 text-white p-1 rounded-md shadow-xs transition-colors"
                        aria-label={`Remove photo ${idx + 1}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded font-mono">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || photos.length < 3}
                className="w-full h-12 min-h-[44px] flex items-center justify-center bg-[#0F172A] hover:bg-[#1E293B] active:scale-[0.99] text-white text-sm font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account...' : 'Complete Sign up'}
              </button>
            </div>
          </form>

          <div className="mt-5 text-center border-t border-slate-100 pt-4">
            <Link
              to="/login"
              className="text-xs font-semibold text-blue-600 hover:text-blue-500"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
