import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle, ArrowLeft, ArrowRight, Loader2, LogOut } from 'lucide-react';
import BottomNav from '../components/BottomNav';

type FlowStage = 'CODE' | 'FACE_CHECK' | 'RESULT';
type FaceSubStep = 'FETCHING' | 'LOOK_STRAIGHT' | 'TURN_HEAD' | 'SUBMITTING';

export default function StudentCapture() {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [flowStage, setFlowStage] = useState<FlowStage>('CODE');
  const [subStep, setSubStep] = useState<FaceSubStep>('FETCHING');
  const [challengeAction, setChallengeAction] = useState<'TURN_LEFT' | 'TURN_RIGHT' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  // Attach stream once on mount after persistent video element is mounted
  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            console.error('video.play() failed:', playErr);
          }
        }
      } catch (err: any) {
        console.error('Failed to access camera:', err);
        if (isMounted) {
          setErrorMessage('Failed to access camera. Please allow camera permissions in your browser.');
        }
      }
    };

    startCamera();

    // Stop only on unmount
    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [stopCamera]);

  // Focus first input box on load
  useEffect(() => {
    if (flowStage === 'CODE' && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [flowStage]);

  // Frame capture: skip if video.readyState < 2 or video.videoWidth === 0
  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }

    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > 480) {
      height = Math.round((height * 480) / width);
      width = 480;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw raw un-mirrored frame
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // 6-digit box handlers
  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) {
      const newDigits = [...digits];
      newDigits[index] = '';
      setDigits(newDigits);
      return;
    }

    if (cleaned.length > 1) {
      const newDigits = [...digits];
      for (let i = 0; i < cleaned.length && index + i < 6; i++) {
        newDigits[index + i] = cleaned[i];
      }
      setDigits(newDigits);
      const nextFocus = Math.min(index + cleaned.length, 5);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = cleaned[0];
    setDigits(newDigits);

    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
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

    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  const fullCode = digits.join('');

  const handleStartFaceCheck = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (fullCode.length !== 6) {
      setErrorMessage('Please enter a valid 6-character session code.');
      return;
    }

    if (videoRef.current && videoRef.current.paused) {
      try {
        await videoRef.current.play();
      } catch (err) {
        console.error('Error starting video play:', err);
      }
    }

    setErrorMessage('');
    setFlowStage('FACE_CHECK');
    setSubStep('FETCHING');
    setProgressPercent(10);

    const token = localStorage.getItem('token');
    const API_URL = import.meta.env.VITE_API_URL || '';

    try {
      // 1. Fetch challenge
      const challengeRes = await fetch(`${API_URL}/api/attendance/challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: fullCode }),
      });

      const challengeData = await challengeRes.json();

      if (!challengeRes.ok) {
        if (challengeRes.status === 429) {
          throw new Error('Too many attempts for this session. Please wait or contact faculty.');
        }
        if (challengeData.code === 'FACE_NOT_ENROLLED') {
          throw new Error('Your face is not enrolled in the system. Contact faculty or admin.');
        }
        throw new Error(challengeData.message || 'Failed to start challenge');
      }

      const { challengeId, action } = challengeData;
      setChallengeAction(action);
      setProgressPercent(25);

      // 2. Look straight (capture 2 frames over ~0.8s)
      setSubStep('LOOK_STRAIGHT');
      await sleep(350);
      const f1 = captureFrame();
      setProgressPercent(35);
      await sleep(400);
      const f2 = captureFrame();
      setProgressPercent(45);

      const frames: string[] = [f1, f2].filter(Boolean) as string[];

      // 3. Turn head instruction + capture 1 frame per 250ms for 3s (12 frames)
      setSubStep('TURN_HEAD');
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const frame = captureFrame();
        if (frame) frames.push(frame);
        setProgressPercent(45 + Math.round(((i + 1) / 12) * 45));
      }

      // Check valid frames: skip API if fewer than 8 valid frames were captured
      if (frames.length < 8) {
        throw new Error('Camera not ready, please try again');
      }

      // 4. Submit attendance with frames
      setSubStep('SUBMITTING');
      setProgressPercent(95);

      const submitRes = await fetch(`${API_URL}/api/attendance/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: fullCode,
          challengeId,
          frames,
        }),
      });

      const submitData = await submitRes.json();

      if (!submitRes.ok) {
        if (submitRes.status === 429) {
          throw new Error('Too many attempts for this session. Please wait or contact faculty.');
        }
        switch (submitData.code) {
          case 'NO_FACE':
            throw new Error('No face detected. Please ensure your face is clearly visible.');
          case 'MULTIPLE_FACES':
            throw new Error('Multiple faces detected. Please ensure only you are in frame.');
          case 'LIVENESS_FAILED':
            throw new Error('Liveness check failed. Please look straight first, then turn your head as prompted.');
          case 'FACE_MISMATCH':
            throw new Error('Face does not match your enrolled reference photo. Please try again.');
          case 'FACE_NOT_ENROLLED':
            throw new Error('Your face is not enrolled in the system. Contact faculty or admin.');
          case 'CHALLENGE_INVALID':
            throw new Error('Challenge expired or invalid. Please try again.');
          default:
            throw new Error(submitData.message || 'Verification failed. Please try again.');
        }
      }

      // Success: stop stream after submit
      setProgressPercent(100);
      setSuccess(true);
      setFlowStage('RESULT');
      stopCamera();

      // Auto-logout after 3 seconds
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Face check failed');
      setFlowStage('RESULT');
      setSuccess(false);
    }
  };

  const handleTryAgain = () => {
    setErrorMessage('');
    setFlowStage('CODE');
    setSuccess(false);
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleLogout = () => {
    stopCamera();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col justify-between safe-pt pb-28">
      {/* Hidden canvas for un-mirrored frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Main Content Area */}
      <div className="w-full max-w-[360px] sm:max-w-md mx-auto px-4 py-4 space-y-4">
        {/* Top Header */}
        <header className="flex items-center justify-between clay-topbar px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl clay-tile text-[#5B4BF0] font-black text-sm flex items-center justify-center select-none shadow-xs">
              M
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#1B1640] leading-tight">MegaByte</h2>
              <span className="text-[10px] uppercase tracking-wider text-[#5B6190] font-extrabold">Student Portal</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center text-[#5B6190] hover:text-[#F43F5E] transition-colors"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        {/* STEP 3: RESULT SCREEN */}
        {flowStage === 'RESULT' && (
          <div className="clay-card p-6 text-center space-y-5">
            {success ? (
              <>
                <div className="w-16 h-16 rounded-2xl clay-tile text-[#065F46] flex items-center justify-center mx-auto">
                  <CheckCircle className="h-9 w-9 text-[#34D399]" />
                </div>
                <div className="space-y-1.5">
                  <span className="clay-chip clay-chip-success">
                    Verified
                  </span>
                  <h3 className="text-base font-extrabold text-[#1B1640]">
                    Attendance submitted — awaiting faculty approval
                  </h3>
                  <p className="text-xs font-semibold text-[#5B6190] max-w-xs mx-auto">
                    Your verification record has been saved.
                  </p>
                </div>
                <div className="p-3 clay-card-flat text-xs text-[#5B6190]">
                  <p className="font-extrabold text-[#1B1640]">Logging you out securely...</p>
                  <p className="text-[11px] font-semibold text-[#5B6190] mt-0.5">Redirecting to login in 3 seconds</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl clay-tile text-[#F43F5E] flex items-center justify-center mx-auto">
                  <AlertCircle className="h-9 w-9 text-[#F43F5E]" />
                </div>
                <div className="space-y-1.5">
                  <span className="clay-chip clay-chip-danger">
                    Verification Failed
                  </span>
                  <h3 className="text-base font-extrabold text-[#1B1640]">
                    Unable to verify attendance
                  </h3>
                  <p className="text-xs font-bold text-[#F43F5E] px-3 py-2 bg-rose-50/80 rounded-2xl border border-rose-200">
                    {errorMessage || 'Verification failed. Please try again.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleTryAgain}
                  className="w-full h-12 min-h-[44px] clay-btn clay-btn-primary text-sm font-extrabold rounded-full"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}

        {/* STEP 2: PERSISTENT FACE-CHECK VIEWFINDER (never conditionally unmounted) */}
        <div
          className={
            flowStage === 'FACE_CHECK'
              ? 'clay-card p-6 space-y-6 text-center'
              : 'fixed -left-[9999px] -top-[9999px] w-[320px] pointer-events-none'
          }
        >
          {/* Instruction Heading */}
          <div className="min-h-[56px] flex flex-col items-center justify-center">
            {subStep === 'FETCHING' && (
              <div className="flex items-center gap-2 text-[#1B1640] font-bold text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B4BF0]" />
                <span>Preparing face check...</span>
              </div>
            )}

            {subStep === 'LOOK_STRAIGHT' && (
              <div className="space-y-1">
                <h3 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">
                  Look straight
                </h3>
                <p className="text-xs text-[#5B6190] font-semibold">
                  Center your face and look directly at the lens
                </p>
              </div>
            )}

            {subStep === 'TURN_HEAD' && challengeAction && (
              <div className="space-y-1">
                <h3 className="text-2xl font-extrabold text-[#D97706] tracking-tight flex items-center justify-center gap-2">
                  {challengeAction === 'TURN_LEFT' ? (
                    <>
                      <ArrowLeft className="h-6 w-6 animate-pulse" />
                      <span>Turn head to YOUR LEFT</span>
                    </>
                  ) : (
                    <>
                      <span>Turn head to YOUR RIGHT</span>
                      <ArrowRight className="h-6 w-6 animate-pulse" />
                    </>
                  )}
                </h3>
                <p className="text-xs text-[#5B6190] font-semibold">
                  Slowly rotate your head until check finishes
                </p>
              </div>
            )}

            {subStep === 'SUBMITTING' && (
              <div className="flex items-center gap-2 text-[#1B1640] font-bold text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-[#34D399]" />
                <span>Verifying face & liveness...</span>
              </div>
            )}
          </div>

          {/* Circular Camera Viewfinder with ONE persistent video */}
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 mx-auto">
            {/* Outer Progress Ring */}
            <div className="absolute -inset-2 rounded-full border-4 border-slate-200/50 overflow-hidden" />
            <div
              className="absolute -inset-2 rounded-full border-4 border-transparent transition-all duration-300"
              style={{
                borderTopColor: subStep === 'TURN_HEAD' ? '#D97706' : '#5B4BF0',
                borderRightColor:
                  progressPercent > 50
                    ? subStep === 'TURN_HEAD'
                      ? '#D97706'
                      : '#5B4BF0'
                    : 'transparent',
                transform: `rotate(${progressPercent * 3.6}deg)`,
              }}
            />

            {/* Viewfinder Circle */}
            <div className="w-full h-full rounded-full overflow-hidden bg-slate-900 border-4 border-white shadow-xl relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ objectFit: 'cover', transform: 'scaleX(-1)' }}
                className="w-full h-full"
              />

              {/* Subtle Framing Silhouette */}
              <div className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
              <div className="absolute inset-8 rounded-full border border-dashed border-white/30 pointer-events-none" />

              {/* Submitting Overlay */}
              {subStep === 'SUBMITTING' && (
                <div className="absolute inset-0 bg-[#1B1640]/80 flex flex-col items-center justify-center text-white space-y-2 p-4">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                  <p className="text-xs font-bold">Submitting attendance...</p>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between text-[11px] font-extrabold text-[#5B6190] uppercase tracking-wider">
              <span>Progress</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-[#E8EEFB] h-2 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-[#5B4BF0] to-[#4F46E5] rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* STEP 1: CODE ENTRY */}
        {flowStage === 'CODE' && (
          <div className="clay-card p-6 space-y-5">
            <div className="text-center space-y-1">
              <span className="clay-chip clay-chip-pressed text-[10px]">
                Attendance Check-in
              </span>
              <h3 className="text-lg font-extrabold text-[#1B1640]">Enter Session Code</h3>
              <p className="text-xs font-semibold text-[#5B6190]">
                Enter the 6-character code displayed by your faculty
              </p>
            </div>

            {errorMessage && (
              <div className="clay-chip-danger px-3.5 py-2.5 rounded-2xl text-xs font-bold w-full flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleStartFaceCheck} className="space-y-5">
              <div>
                <label className="label-clay block text-center mb-2.5">
                  6-Character Session Code
                </label>
                <div className="flex justify-between gap-1.5 sm:gap-2 max-w-[300px] mx-auto">
                  {digits.map((digit, idx) => (
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
                      className="w-10 h-12 sm:w-11 sm:h-13 text-center font-mono text-xl font-black uppercase clay-tile-code"
                      aria-label={`Digit ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={fullCode.length !== 6}
                className="w-full h-12 min-h-[44px] clay-btn clay-btn-primary text-sm font-extrabold rounded-full"
              >
                Start Face Check
              </button>
            </form>

            {user.name && (
              <div className="text-center pt-2 border-t border-slate-200/60">
                <p className="text-[11px] font-semibold text-[#5B6190]">
                  Signed in as <span className="font-extrabold text-[#1B1640]">{user.name}</span> ({user.student_id})
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Persistent Bottom Navigation */}
      <BottomNav activeTab="verify" onNavigate={stopCamera} />
    </div>
  );
}
