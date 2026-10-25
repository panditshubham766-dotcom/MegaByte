import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  LogOut,
  MapPin,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Compass,
  Radio,
  Info
} from 'lucide-react';
import BottomNav from '../components/BottomNav';

type FlowStage = 'CODE' | 'VERIFYING' | 'RESULT';
type FaceSubStep = 'PROBING_SENSORS' | 'LOOK_STRAIGHT' | 'TURN_HEAD' | 'SUBMITTING';

interface SessionMetadata {
  sessionCode: string;
  classroomName: string;
  subjectName: string;
  className: string;
  policy?: string;
}

interface LocationStatus {
  status: 'PENDING' | 'ACQUIRED' | 'VERIFIED' | 'DENIED' | 'OUTSIDE' | 'LOW_ACCURACY';
  distanceM?: number | null;
  accuracyM?: number | null;
  details?: string;
}

interface WifiStatus {
  status: 'CHECKING' | 'VERIFIED' | 'UNSUPPORTED' | 'NOT_REQUIRED' | 'UNAPPROVED' | 'UNAVAILABLE';
  ssid?: string | null;
  bssid?: string | null;
  details?: string;
}

interface FaceStatus {
  status: 'IDLE' | 'DETECTING' | 'LIVENESS_CHECK' | 'MATCHING' | 'PASSED' | 'FAILED';
  matchScore?: number;
  livenessScore?: number;
  details?: string;
}

export default function MobileStudentCapture() {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [flowStage, setFlowStage] = useState<FlowStage>('CODE');
  const [subStep, setSubStep] = useState<FaceSubStep>('PROBING_SENSORS');
  const [challengeAction, setChallengeAction] = useState<'TURN_LEFT' | 'TURN_RIGHT' | null>(null);
  
  // Verification states
  const [sessionInfo, setSessionInfo] = useState<SessionMetadata | null>(null);
  const [gpsStatus, setGpsStatus] = useState<LocationStatus>({ status: 'PENDING' });
  const [wifiStatus, setWifiStatus] = useState<WifiStatus>({ status: 'NOT_REQUIRED' });
  const [faceStatus, setFaceStatus] = useState<FaceStatus>({ status: 'IDLE' });
  const [overallStatus, setOverallStatus] = useState<'UNVERIFIED' | 'IN_PROGRESS' | 'PASSED' | 'REJECTED'>('UNVERIFIED');

  // Error & guidance handling
  const [errorCode, setErrorCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryHint, setRetryHint] = useState('');
  const [success, setSuccess] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });

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
      setErrorCode('CAMERA_PERMISSION_DENIED');
      setErrorMessage('Camera access was denied or is unavailable.');
      setRetryHint('Please allow camera permissions in your browser or app settings.');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (flowStage === 'CODE' && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [flowStage]);

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

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

  const acquireLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number; timestamp: string } | null> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus({ status: 'DENIED', details: 'Geolocation not supported' });
      return null;
    }

    setGpsStatus({ status: 'PENDING', details: 'Acquiring GPS fix...' });

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
          };
          setGpsStatus({
            status: 'ACQUIRED',
            accuracyM: loc.accuracy,
            details: `GPS Fix (±${loc.accuracy}m)`,
          });
          resolve(loc);
        },
        (err) => {
          console.warn('Geolocation error:', err);
          if (err.code === 1) {
            setGpsStatus({ status: 'DENIED', details: 'Location permission denied' });
          } else {
            setGpsStatus({ status: 'LOW_ACCURACY', details: 'Weak GPS signal' });
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  };

  const probeWifi = async (): Promise<{ bssid: string | null; ssid: string | null; status: string }> => {
    if (typeof window !== 'undefined') {
      const win = window as any;
      if (win.Capacitor?.Plugins?.Network?.getWifiInfo) {
        try {
          const info = await win.Capacitor.Plugins.Network.getWifiInfo();
          if (info.bssid) {
            setWifiStatus({
              status: 'VERIFIED',
              bssid: info.bssid,
              ssid: info.ssid || 'Campus AP',
              details: `Connected: ${info.ssid || info.bssid}`,
            });
            return { bssid: info.bssid, ssid: info.ssid || null, status: 'AVAILABLE' };
          }
        } catch {}
      } else if (win.AndroidBridge?.getConnectedBssid) {
        try {
          const bssid = win.AndroidBridge.getConnectedBssid();
          const ssid = win.AndroidBridge.getConnectedSsid ? win.AndroidBridge.getConnectedSsid() : null;
          if (bssid) {
            setWifiStatus({
              status: 'VERIFIED',
              bssid,
              ssid: ssid || 'Campus AP',
              details: `Connected: ${ssid || bssid}`,
            });
            return { bssid, ssid, status: 'AVAILABLE' };
          }
        } catch {}
      }
    }

    setWifiStatus({
      status: 'UNSUPPORTED',
      details: 'Browser JS (GPS policy active)',
    });
    return { bssid: null, ssid: null, status: 'UNSUPPORTED_DEVICE' };
  };

  const handleStartVerification = async (e?: FormEvent) => {
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
    setErrorCode('');
    setRetryHint('');
    setFlowStage('VERIFYING');
    setSubStep('PROBING_SENSORS');
    setOverallStatus('IN_PROGRESS');
    setProgressPercent(10);
    setIsSubmitting(true);

    const token = localStorage.getItem('token');
    const API_URL = import.meta.env.VITE_API_URL || '';

    try {
      const clientLocation = await acquireLocation();
      const clientWifi = await probeWifi();

      setProgressPercent(20);

      let challengeRes: globalThis.Response;
      try {
        challengeRes = await fetch(`${API_URL}/api/attendance/challenge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code: fullCode, location: clientLocation, wifi: clientWifi }),
        });
      } catch {
        throw {
          code: 'NETWORK_ERROR',
          message: 'Unable to reach attendance verification server.',
          retryHint: 'Check network connectivity and retry.',
        };
      }

      const challengeData = await challengeRes.json();

      if (!challengeRes.ok) {
        setOverallStatus('REJECTED');
        if (challengeData.code === 'LOCATION_REQUIRED' || challengeData.code === 'PERMISSION_DENIED') {
          setGpsStatus({ status: 'DENIED', details: 'Location access required' });
        } else if (challengeData.code === 'OUTSIDE_CLASSROOM') {
          setGpsStatus({ status: 'OUTSIDE', distanceM: challengeData.distanceMeters, details: challengeData.message });
        } else if (challengeData.code === 'ACCURACY_TOO_LOW' || challengeData.code === 'STALE_LOCATION') {
          setGpsStatus({ status: 'LOW_ACCURACY', details: challengeData.message });
        } else if (challengeData.code === 'UNAPPROVED_ACCESS_POINT') {
          setWifiStatus({ status: 'UNAPPROVED', details: challengeData.message });
        }
        throw {
          code: challengeData.code || 'CHALLENGE_FAILED',
          message: challengeData.message || 'Verification challenge failed.',
          retryHint: challengeData.retryHint || '',
        };
      }

      const {
        challengeId,
        action,
        classroomName,
        subjectName,
        className,
        locationDistanceM,
        locationAccuracyM,
        locationVerified,
        wifiStatus: bWifiStatus,
        wifiVerified,
        wifiSsid,
        policy,
      } = challengeData;

      setSessionInfo({
        sessionCode: fullCode,
        classroomName: classroomName || 'Assigned Classroom',
        subjectName: subjectName || 'Class Session',
        className: className || '',
        policy: policy || 'GPS_ONLY',
      });

      setGpsStatus({
        status: locationVerified ? 'VERIFIED' : 'PENDING',
        distanceM: locationDistanceM,
        accuracyM: locationAccuracyM,
        details: locationVerified
          ? `In Classroom (${Math.round(locationDistanceM || 0)}m) • ±${Math.round(locationAccuracyM || 0)}m`
          : 'Geofence check bypassed',
      });

      setWifiStatus({
        status: wifiVerified ? 'VERIFIED' : bWifiStatus === 'UNSUPPORTED_DEVICE' ? 'UNSUPPORTED' : 'NOT_REQUIRED',
        ssid: wifiSsid,
        details: wifiVerified ? `Connected to ${wifiSsid}` : 'Policy met via GPS',
      });

      setChallengeAction(action);
      setFaceStatus({ status: 'DETECTING', details: 'Look directly at camera' });
      setProgressPercent(30);

      // Look straight (2 frames)
      setSubStep('LOOK_STRAIGHT');
      await sleep(350);
      const f1 = captureFrame();
      setProgressPercent(40);
      await sleep(400);
      const f2 = captureFrame();
      setProgressPercent(50);

      const frames: string[] = [f1, f2].filter(Boolean) as string[];

      // Turn head challenge
      setSubStep('TURN_HEAD');
      setFaceStatus({
        status: 'LIVENESS_CHECK',
        details: `Turn head ${action === 'TURN_LEFT' ? 'LEFT' : 'RIGHT'}`,
      });

      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const frame = captureFrame();
        if (frame) frames.push(frame);
        setProgressPercent(50 + Math.round(((i + 1) / 12) * 40));
      }

      if (frames.length < 8) {
        throw {
          code: 'CAMERA_FRAME_ERROR',
          message: 'Insufficient video frames captured from camera.',
          retryHint: 'Hold phone steady and follow head prompt.',
        };
      }

      // Submit attendance
      setSubStep('SUBMITTING');
      setFaceStatus({ status: 'MATCHING', details: 'Validating biometrics & presence...' });
      setProgressPercent(95);

      let submitRes: globalThis.Response;
      try {
        submitRes = await fetch(`${API_URL}/api/attendance/submit`, {
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
      } catch {
        throw {
          code: 'NETWORK_ERROR',
          message: 'Network interruption during submission.',
          retryHint: 'Check mobile data/Wi-Fi and retry.',
        };
      }

      const submitData = await submitRes.json();

      // REQUIREMENT 1: NEVER DISPLAY SUCCESSFUL VERIFICATION UNTIL THE BACKEND CONFIRMS IT.
      if (!submitRes.ok) {
        setOverallStatus('REJECTED');
        setFaceStatus({ status: 'FAILED' });

        let userMsg = submitData.message || 'Verification failed. Please try again.';
        let userHint = submitData.retryHint || 'Please try again.';

        switch (submitData.code) {
          case 'NO_FACE':
            userMsg = 'No face detected in video stream.';
            userHint = 'Ensure your face is centered and clearly lit.';
            break;
          case 'MULTIPLE_FACES':
            userMsg = 'Multiple faces detected in frame.';
            userHint = 'Ensure only you are in front of the camera.';
            break;
          case 'LIVENESS_FAILED':
            userMsg = 'Liveness verification failed.';
            userHint = 'Look straight first, then turn head in the requested direction.';
            break;
          case 'FACE_MISMATCH':
            userMsg = 'Biometric mismatch: Photo does not match enrolled profile.';
            userHint = 'Ensure good lighting and remove masks/glasses.';
            break;
          case 'CHALLENGE_INVALID':
            userMsg = 'Challenge session expired.';
            userHint = 'Please restart check-in.';
            break;
          default:
            break;
        }

        throw {
          code: submitData.code || 'VERIFICATION_FAILED',
          message: userMsg,
          retryHint: userHint,
        };
      }

      // Backend confirmed HTTP 201
      setProgressPercent(100);
      setVerificationToken(submitData.verification_token);
      setFaceStatus({
        status: 'PASSED',
        matchScore: submitData.face_match_score,
        livenessScore: submitData.liveness_score,
        details: `Match: ${Math.round((submitData.face_match_score || 0) * 100)}% • Liveness: ${Math.round(
          (submitData.liveness_score || 0) * 100
        )}%`,
      });
      setOverallStatus('PASSED');
      setSuccess(true);
      setFlowStage('RESULT');
      setIsSubmitting(false);
      stopCamera();
    } catch (err: any) {
      setErrorCode(err.code || 'UNKNOWN_ERROR');
      setErrorMessage(err.message || 'Face check failed');
      setRetryHint(err.retryHint || '');
      setOverallStatus('REJECTED');
      setFlowStage('RESULT');
      setSuccess(false);
      setIsSubmitting(false);
    }
  };

  const handleTryAgain = () => {
    setErrorMessage('');
    setErrorCode('');
    setRetryHint('');
    setFlowStage('CODE');
    setSuccess(false);
    setOverallStatus('UNVERIFIED');
    setFaceStatus({ status: 'IDLE' });
    setGpsStatus({ status: 'PENDING' });
    setVerificationToken(null);
    setProgressPercent(0);
    setIsSubmitting(false);
    startCamera();
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
              <span className="text-[10px] uppercase tracking-wider text-[#5B6190] font-extrabold">
                {overallStatus === 'PASSED' ? 'Verified' : overallStatus === 'REJECTED' ? 'Verification Failed' : overallStatus === 'IN_PROGRESS' ? 'Verifying...' : 'Student Portal'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center text-[#5B6190] hover:text-[#F43F5E] transition-colors cursor-pointer"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        {/* Assigned Classroom & Session Banner */}
        {sessionInfo && (
          <div className="clay-card p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="clay-chip clay-chip-pressed text-[9px]">
                Assigned Classroom
              </span>
              <span className="text-[11px] font-mono font-extrabold text-[#1B1640]">
                Code: {sessionInfo.sessionCode}
              </span>
            </div>
            <h3 className="text-sm font-extrabold text-[#1B1640]">{sessionInfo.classroomName}</h3>
            <p className="text-[11px] font-semibold text-[#5B6190]">
              {sessionInfo.subjectName} {sessionInfo.className ? `• ${sessionInfo.className}` : ''}
            </p>
          </div>
        )}

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
                    Server Verified
                  </span>
                  <h3 className="text-base font-extrabold text-[#1B1640]">
                    Attendance Submitted Successfully
                  </h3>
                  <p className="text-xs font-semibold text-[#5B6190] max-w-xs mx-auto">
                    GPS Geofence, Wi-Fi policy, and Biometric Liveness confirmed by server.
                  </p>
                </div>

                {verificationToken && (
                  <div className="p-3 clay-card-flat text-left space-y-1 text-xs">
                    <div className="flex justify-between text-[#5B6190] font-mono text-[11px]">
                      <span>Token:</span>
                      <span className="text-emerald-600 font-bold">{verificationToken.slice(0, 16)}...</span>
                    </div>
                    {faceStatus.matchScore !== undefined && (
                      <div className="flex justify-between text-[#5B6190] text-[11px]">
                        <span>Face Match:</span>
                        <span className="font-bold text-[#1B1640]">{Math.round(faceStatus.matchScore * 100)}%</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full h-12 min-h-[44px] clay-btn clay-btn-primary text-sm font-extrabold rounded-full flex items-center justify-center cursor-pointer"
                  >
                    Done & Log Out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl clay-tile text-[#F43F5E] flex items-center justify-center mx-auto">
                  <ShieldAlert className="h-9 w-9 text-[#F43F5E]" />
                </div>
                <div className="space-y-1.5">
                  <span className="clay-chip clay-chip-danger">
                    Verification Failed
                  </span>
                  <h3 className="text-base font-extrabold text-[#1B1640]">
                    Presence Check Incomplete
                  </h3>
                </div>

                <div className="clay-card-flat p-3.5 text-left space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-[#F43F5E] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-[#F43F5E]">{errorMessage}</p>
                      {errorCode && (
                        <span className="text-[10px] font-mono text-[#F43F5E]/80 block mt-0.5">
                          Code: {errorCode}
                        </span>
                      )}
                    </div>
                  </div>
                  {retryHint && (
                    <div className="pt-2 border-t border-slate-200 text-[11px] text-[#5B6190] flex items-start gap-1.5">
                      <Info className="h-3.5 w-3.5 text-[#5B4BF0] shrink-0 mt-0.5" />
                      <span>{retryHint}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleTryAgain}
                    className="flex-1 h-12 clay-btn clay-btn-primary text-xs font-extrabold rounded-full flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="h-12 px-5 clay-btn clay-btn-secondary text-xs font-extrabold rounded-full flex items-center justify-center cursor-pointer"
                  >
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2: VERIFICATION VIEWFINDER */}
        <div
          className={
            flowStage === 'VERIFYING'
              ? 'clay-card p-6 space-y-6 text-center'
              : 'fixed -left-[9999px] -top-[9999px] w-[320px] pointer-events-none'
          }
        >
          {/* Status Instruction Heading */}
          <div className="min-h-[56px] flex flex-col items-center justify-center">
            {subStep === 'PROBING_SENSORS' && (
              <div className="flex items-center gap-2 text-[#1B1640] font-bold text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-[#5B4BF0]" />
                <span>Checking classroom GPS & policy...</span>
              </div>
            )}

            {subStep === 'LOOK_STRAIGHT' && (
              <div className="space-y-1">
                <h3 className="text-2xl font-extrabold text-[#1B1640] tracking-tight">
                  Look straight
                </h3>
                <p className="text-xs text-[#5B6190] font-semibold">
                  Center face directly at camera
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
                  Slowly rotate head until check finishes
                </p>
              </div>
            )}

            {subStep === 'SUBMITTING' && (
              <div className="flex items-center gap-2 text-[#1B1640] font-bold text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-[#34D399]" />
                <span>Verifying biometrics & presence on server...</span>
              </div>
            )}
          </div>

          {/* Viewfinder Circle */}
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 mx-auto">
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

            <div className="w-full h-full rounded-full overflow-hidden bg-slate-900 border-4 border-white shadow-xl relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ objectFit: 'cover', transform: 'scaleX(-1)' }}
                className="w-full h-full"
              />
              <div className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
              <div className="absolute inset-8 rounded-full border border-dashed border-white/30 pointer-events-none" />

              {subStep === 'SUBMITTING' && (
                <div className="absolute inset-0 bg-[#1B1640]/80 flex flex-col items-center justify-center text-white space-y-2 p-4">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                  <p className="text-xs font-bold">Submitting attendance...</p>
                </div>
              )}
            </div>
          </div>

          {/* Real-time Presence Indicators */}
          <div className="grid grid-cols-2 gap-2 text-left pt-1">
            <div className="clay-card-flat p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#5B6190] mb-0.5">
                <span className="flex items-center gap-1 font-extrabold text-[#1B1640]">
                  <MapPin className="h-3 w-3 text-[#5B4BF0]" /> GPS
                </span>
                {gpsStatus.status === 'VERIFIED' ? (
                  <CheckCircle className="h-3 w-3 text-[#34D399]" />
                ) : (
                  <Compass className="h-3 w-3 text-[#5B6190]" />
                )}
              </div>
              <p className="text-[10px] text-[#5B6190] font-bold truncate">
                {gpsStatus.details || 'Pending fix'}
              </p>
            </div>

            <div className="clay-card-flat p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[#5B6190] mb-0.5">
                <span className="flex items-center gap-1 font-extrabold text-[#1B1640]">
                  <Wifi className="h-3 w-3 text-[#5B4BF0]" /> Wi-Fi
                </span>
                {wifiStatus.status === 'VERIFIED' ? (
                  <CheckCircle className="h-3 w-3 text-[#34D399]" />
                ) : wifiStatus.status === 'UNAPPROVED' ? (
                  <WifiOff className="h-3 w-3 text-[#F43F5E]" />
                ) : (
                  <Radio className="h-3 w-3 text-[#5B6190]" />
                )}
              </div>
              <p className="text-[10px] text-[#5B6190] font-bold truncate">
                {wifiStatus.details || 'Policy dependent'}
              </p>
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
                Presence Verification
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

            <form onSubmit={handleStartVerification} className="space-y-5">
              <div>
                <label className="label-clay block text-center mb-2.5">
                  6-Character Code
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

              {/* Requirement 2: Disable attendance submission until checks pass */}
              <button
                type="submit"
                disabled={fullCode.length !== 6 || isSubmitting}
                className="w-full h-12 min-h-[44px] clay-btn clay-btn-primary text-sm font-extrabold rounded-full flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking Requirements...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Verify Presence & Check In
                  </>
                )}
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
