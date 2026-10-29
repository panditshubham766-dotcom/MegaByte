import { useState, useRef, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  MapPin,
  Wifi,
  WifiOff,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  LogOut,
  Compass,
  Radio,
  Info
} from 'lucide-react';

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

export default function StudentCapture() {
  const [sessionCode, setSessionCode] = useState('');
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
  const [progressPercent, setProgressPercent] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
      setRetryHint('Please allow camera permissions in your browser address bar.');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

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

  // Acquire fresh GPS location
  const acquireLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number; timestamp: string } | null> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsStatus({ status: 'DENIED', details: 'Geolocation is not supported by your browser.' });
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
            details: 'GPS Fix acquired',
          });
          resolve(loc);
        },
        (err) => {
          console.warn('Geolocation error:', err);
          if (err.code === 1) {
            setGpsStatus({ status: 'DENIED', details: 'Location permission was denied.' });
          } else {
            setGpsStatus({ status: 'LOW_ACCURACY', details: 'Unable to acquire accurate GPS fix.' });
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  };

  // Inspect Wi-Fi state (supports native Capacitor / Android bridge, or documents web fallback)
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
              ssid: info.ssid || 'Campus Network',
              details: `Connected: ${info.ssid || info.bssid}`,
            });
            return { bssid: info.bssid, ssid: info.ssid || null, status: 'AVAILABLE' };
          }
        } catch {
          // Handled below
        }
      } else if (win.AndroidBridge?.getConnectedBssid) {
        try {
          const bssid = win.AndroidBridge.getConnectedBssid();
          const ssid = win.AndroidBridge.getConnectedSsid ? win.AndroidBridge.getConnectedSsid() : null;
          if (bssid) {
            setWifiStatus({
              status: 'VERIFIED',
              bssid,
              ssid: ssid || 'Campus Network',
              details: `Connected: ${ssid || bssid}`,
            });
            return { bssid, ssid, status: 'AVAILABLE' };
          }
        } catch {
          // Handled below
        }
      }
    }

    // Standard web browser fallback
    setWifiStatus({
      status: 'UNSUPPORTED',
      details: 'Browser JS cannot read BSSID (GPS policy fallback applied).',
    });
    return { bssid: null, ssid: null, status: 'UNSUPPORTED_DEVICE' };
  };

  const handleStartVerification = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = sessionCode.trim().toUpperCase();
    if (cleanCode.length !== 6) {
      setErrorMessage('Please enter a valid 6-character session code.');
      setRetryHint('');
      return;
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
      // 1. Acquire GPS location and Wi-Fi presence evidence
      const clientLocation = await acquireLocation();
      if (!clientLocation) {
        setOverallStatus('REJECTED');
        setGpsStatus({ status: 'DENIED', details: 'Location access required' });
        throw {
          code: 'LOCATION_REQUIRED',
          message: 'Location access required to verify classroom attendance.',
          retryHint: 'Enable GPS and grant high-accuracy location permission.',
        };
      }
      const clientWifi = await probeWifi();

      setProgressPercent(20);

      // 2. Request challenge from backend with multi-factor evidence
      let challengeRes: globalThis.Response;
      try {
        challengeRes = await fetch(`${API_URL}/api/attendance/challenge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code: cleanCode, location: clientLocation, wifi: clientWifi }),
        });
      } catch (netErr: any) {
        throw {
          code: 'NETWORK_ERROR',
          message: 'Unable to connect to the attendance server.',
          retryHint: 'Check your internet connection and try again.',
        };
      }

      const challengeData = await challengeRes.json();

      if (!challengeRes.ok) {
        setOverallStatus('REJECTED');
        const errObj = {
          code: challengeData.code || 'CHALLENGE_FAILED',
          message: challengeData.message || 'Verification challenge failed.',
          retryHint: challengeData.retryHint || '',
        };

        // Specific status reflections
        if (challengeData.code === 'LOCATION_REQUIRED' || challengeData.code === 'PERMISSION_DENIED') {
          setGpsStatus({ status: 'DENIED', details: 'Location access required' });
        } else if (challengeData.code === 'OUTSIDE_CLASSROOM' || challengeData.code === 'LOCATION_TOO_FAR') {
          setGpsStatus({
            status: 'OUTSIDE',
            details: 'You are too far from the classroom. Move closer to the faculty and try again.',
          });
        } else if (challengeData.code === 'ACCURACY_TOO_LOW' || challengeData.code === 'STALE_LOCATION') {
          setGpsStatus({ status: 'LOW_ACCURACY', details: challengeData.message });
        } else if (challengeData.code === 'UNAPPROVED_ACCESS_POINT' || challengeData.code === 'BSSID_REQUIRED') {
          setWifiStatus({ status: 'UNAPPROVED', details: challengeData.message });
        } else if (challengeData.code === 'UNSUPPORTED_DEVICE') {
          setWifiStatus({ status: 'UNSUPPORTED', details: challengeData.message });
        }

        throw errObj;
      }

      // Backend confirmed classroom eligibility & presence
      const {
        challengeId,
        action,
        classroomName,
        subjectName,
        className,
        locationDistanceM,
        locationAccuracyM,
        locationVerified,
        wifiStatus: backendWifiStatus,
        wifiVerified,
        wifiSsid,
        policy,
      } = challengeData;

      setSessionInfo({
        sessionCode: cleanCode,
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
          ? 'Location verified'
          : 'Geofence check bypassed or not required',
      });

      setWifiStatus({
        status: wifiVerified ? 'VERIFIED' : backendWifiStatus === 'UNSUPPORTED_DEVICE' ? 'UNSUPPORTED' : 'NOT_REQUIRED',
        ssid: wifiSsid,
        details: wifiVerified
          ? `Connected to ${wifiSsid || 'Classroom AP'}`
          : backendWifiStatus === 'UNSUPPORTED_DEVICE'
          ? 'Browser mode: Policy fulfilled via GPS'
          : 'Wi-Fi check not required',
      });

      setChallengeAction(action);
      setFaceStatus({ status: 'DETECTING', details: 'Look directly at camera' });
      setProgressPercent(30);

      // 3. Face verification pipeline - Frontal frame capture
      setSubStep('LOOK_STRAIGHT');
      await sleep(400);
      const f1 = captureFrame();
      setProgressPercent(40);
      await sleep(400);
      const f2 = captureFrame();
      setProgressPercent(50);

      const frames: string[] = [f1, f2].filter(Boolean) as string[];

      // 4. Liveness head-turn challenge
      setSubStep('TURN_HEAD');
      setFaceStatus({
        status: 'LIVENESS_CHECK',
        details: `Turn head ${action === 'TURN_LEFT' ? 'LEFT' : 'RIGHT'} as prompted`,
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
          retryHint: 'Keep your face steadily in front of the camera and try again.',
        };
      }

      // 5. Submit attendance to backend with verified location for server-side verification confirmation
      setSubStep('SUBMITTING');
      setFaceStatus({ status: 'MATCHING', details: 'Analyzing biometrics & liveness on server...' });
      setProgressPercent(95);

      const submitLocation = await acquireLocation() || clientLocation;
      if (!submitLocation) {
        setOverallStatus('REJECTED');
        setGpsStatus({ status: 'DENIED', details: 'Location access required' });
        throw {
          code: 'LOCATION_REQUIRED',
          message: 'Location access required to submit attendance.',
          retryHint: 'Enable GPS and grant high-accuracy location permission.',
        };
      }

      let submitRes: globalThis.Response;
      try {
        submitRes = await fetch(`${API_URL}/api/attendance/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            code: cleanCode,
            challengeId,
            frames,
            location: submitLocation,
          }),
        });
      } catch (submitNetErr: any) {
        throw {
          code: 'NETWORK_ERROR',
          message: 'Failed to submit verification frames due to a network interruption.',
          retryHint: 'Check your connection and retry verification.',
        };
      }

      const submitData = await submitRes.json();

      // REQUIREMENT 1: NEVER DISPLAY SUCCESSFUL VERIFICATION UNTIL THE BACKEND CONFIRMS IT.
      if (!submitRes.ok) {
        setOverallStatus('REJECTED');
        setFaceStatus({ status: 'FAILED' });

        let userMsg = submitData.message || 'Verification failed. Please try again.';
        let userHint = submitData.retryHint || 'Please try again in good lighting.';

        switch (submitData.code) {
          case 'LOCATION_REQUIRED':
            userMsg = submitData.message || 'Location access required.';
            userHint = submitData.retryHint || 'Enable location services and try again.';
            setGpsStatus({ status: 'DENIED', details: userMsg });
            break;
          case 'LOCATION_INACCURATE':
          case 'ACCURACY_TOO_LOW':
            userMsg = submitData.message || 'GPS accuracy is too low.';
            userHint = submitData.retryHint || 'Move near a window or open area and try again.';
            setGpsStatus({ status: 'LOW_ACCURACY', details: userMsg });
            break;
          case 'OUTSIDE_CLASSROOM':
          case 'LOCATION_TOO_FAR':
            userMsg = 'You are too far from the classroom. Move closer to the faculty and try again.';
            userHint = submitData.retryHint || 'Move closer to the faculty and try again.';
            setGpsStatus({ status: 'OUTSIDE', details: userMsg });
            break;
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
            userHint = 'Look straight first, then turn your head in the indicated direction.';
            break;
          case 'FACE_MISMATCH':
            userMsg = 'Biometric mismatch: Face does not match your enrolled profile photo.';
            userHint = 'Remove glasses/hats, improve room lighting, or contact faculty to update your enrolled photo.';
            break;
          case 'CHALLENGE_INVALID':
            userMsg = 'Verification challenge expired.';
            userHint = 'Please restart verification with a fresh code.';
            break;
          case 'IDENTITY_SUBSTITUTION_REJECTED':
            userMsg = 'Security rejection: Identity substitution attempt detected.';
            userHint = 'Sign in with your own student credentials.';
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

      // Backend confirmed verification success (HTTP 201)
      setProgressPercent(100);
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
      console.error('Verification error:', err);
      setErrorCode(err.code || 'UNKNOWN_ERROR');
      setErrorMessage(err.message || 'An unexpected verification error occurred.');
      setRetryHint(err.retryHint || 'Please check requirements and try again.');
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
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between p-4 md:p-8 font-sans">
      <div className="max-w-md w-full mx-auto space-y-5">
        {/* Top Header Bar */}
        <header className="flex items-center justify-between bg-slate-800/80 backdrop-blur-md px-4 py-3 rounded-2xl border border-slate-700/60 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-black text-base rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20 select-none">
              M
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">MegaByte Presence</h1>
              <span className="text-[11px] text-slate-400 font-medium">
                {overallStatus === 'PASSED' ? 'Verification Confirmed' : overallStatus === 'REJECTED' ? 'Verification Rejected' : overallStatus === 'IN_PROGRESS' ? 'Verifying Presence...' : 'Classroom Verification'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-700/50 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-600/40 text-xs font-semibold transition-all cursor-pointer"
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Assigned Subject & Session Banner (Visible once code verified or active) */}
        {sessionInfo && (
          <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-800/60 border border-blue-500/30 rounded-2xl p-4 shadow-md backdrop-blur-xs space-y-1.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-400/20">
                {sessionInfo.subjectName || 'Subject'}
              </span>
              <span className="text-xs font-mono font-bold text-slate-300 tracking-wider">
                Code: {sessionInfo.sessionCode}
              </span>
            </div>
            <h2 className="text-base font-bold text-white">{sessionInfo.subjectName || 'Subject'}</h2>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{sessionInfo.subjectName}</span>
              {sessionInfo.className && <span className="text-slate-500">• {sessionInfo.className}</span>}
            </div>
          </div>
        )}

        {/* Main Viewfinder Card */}
        <div className="bg-slate-800/90 rounded-2xl shadow-xl border border-slate-700/70 overflow-hidden p-5 space-y-4">
          {/* Camera Viewfinder */}
          <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-700">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Overlays during Verification Flow */}
            {flowStage === 'VERIFYING' && (
              <div className="absolute inset-0 flex flex-col items-center justify-between p-4 bg-black/40 backdrop-blur-[2px] pointer-events-none">
                <div className="bg-slate-900/85 backdrop-blur-md text-white px-4 py-2 rounded-full text-xs font-medium border border-slate-700/60 shadow-lg text-center max-w-[90%]">
                  {subStep === 'PROBING_SENSORS' && (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                      Acquiring GPS & classroom policy...
                    </span>
                  )}
                  {subStep === 'LOOK_STRAIGHT' && '👁️ Center face & look directly at camera'}
                  {subStep === 'TURN_HEAD' && challengeAction && (
                    <span className="text-amber-300 font-bold flex items-center gap-1.5">
                      {challengeAction === 'TURN_LEFT' ? (
                        <>
                          <ArrowLeft className="h-4 w-4 animate-pulse text-amber-400" /> Turn head to your LEFT
                        </>
                      ) : (
                        <>
                          Turn head to your RIGHT <ArrowRight className="h-4 w-4 animate-pulse text-amber-400" />
                        </>
                      )}
                    </span>
                  )}
                  {subStep === 'SUBMITTING' && (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400" />
                      Verifying biometrics & presence on server...
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-700/60 h-2 rounded-full overflow-hidden shadow-inner border border-slate-600/40">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Verification Status Indicators Grid */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {/* GPS Geofence Status Card */}
            <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  <MapPin className="h-3.5 w-3.5 text-blue-400" /> GPS Geofence
                </span>
                {gpsStatus.status === 'VERIFIED' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                ) : gpsStatus.status === 'DENIED' || gpsStatus.status === 'OUTSIDE' ? (
                  <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Compass className="h-3.5 w-3.5 text-slate-400" />
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-300 truncate">
                {gpsStatus.details || 'Awaiting session code'}
              </p>
            </div>

            {/* Wi-Fi Verification Card */}
            <div className="bg-slate-900/70 border border-slate-700/60 rounded-xl p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  <Wifi className="h-3.5 w-3.5 text-indigo-400" /> Wi-Fi Status
                </span>
                {wifiStatus.status === 'VERIFIED' ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                ) : wifiStatus.status === 'UNAPPROVED' ? (
                  <WifiOff className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Radio className="h-3.5 w-3.5 text-slate-400" />
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-300 truncate">
                {wifiStatus.details || 'Policy dependent'}
              </p>
              {wifiStatus.ssid && (
                <span className="text-[10px] text-slate-400 mt-0.5 truncate">
                  SSID: {wifiStatus.ssid}
                </span>
              )}
            </div>
          </div>

          {/* STAGE 1: SESSION CODE ENTRY */}
          {flowStage === 'CODE' && (
            <form onSubmit={handleStartVerification} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">
                  6-Character Session Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="e.g. A1B2C3"
                  className="appearance-none block w-full px-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl shadow-inner placeholder-slate-500 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-2xl text-center uppercase font-mono tracking-widest font-bold"
                  value={sessionCode}
                  onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                />
              </div>

              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-blue-400" />
                <span>Verification requires GPS & camera presence</span>
              </div>

              {/* Attendance submission is gated and disabled until valid code and checks begin */}
              <button
                type="submit"
                disabled={sessionCode.trim().length !== 6 || isSubmitting}
                className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking Requirements...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Verify Presence & Submit
                  </>
                )}
              </button>
            </form>
          )}

          {/* STAGE 3: RESULT SCREEN */}
          {flowStage === 'RESULT' && (
            <div className="text-center py-2 space-y-4 animate-in fade-in duration-300">
              {success ? (
                <>
                  <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto text-green-400 border border-green-500/30 shadow-lg shadow-green-500/10">
                    <CheckCircle className="h-9 w-9" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-green-400 bg-green-500/10 px-2.5 py-0.5 rounded-full border border-green-500/20 inline-block">
                      Backend Confirmed
                    </span>
                    <h3 className="text-lg font-bold text-white">Attendance Verified & Submitted</h3>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                      Your face and location were verified.
                    </p>
                  </div>

                  {/* Verification Receipt */}
                  {(faceStatus.matchScore !== undefined || faceStatus.livenessScore !== undefined) && (
                    <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/80 text-left space-y-1">
                      {faceStatus.matchScore !== undefined && (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Face Match Score:</span>
                          <span className="text-slate-200 font-mono font-medium">
                            {Math.round(faceStatus.matchScore * 100)}%
                          </span>
                        </div>
                      )}
                      {faceStatus.livenessScore !== undefined && (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Liveness Score:</span>
                          <span className="text-slate-200 font-mono font-medium">
                            {Math.round(faceStatus.livenessScore * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto text-red-400 border border-red-500/30 shadow-lg shadow-red-500/10">
                    <ShieldAlert className="h-9 w-9" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 px-2.5 py-0.5 rounded-full border border-red-500/20 inline-block">
                      Verification Failed
                    </span>
                    <h3 className="text-lg font-bold text-white">Presence Check Incomplete</h3>
                  </div>

                  {/* Structured Error & Resolution Box */}
                  <div className="bg-red-950/30 border border-red-500/40 rounded-xl p-3.5 text-left space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-red-300">{errorMessage}</p>
                        {errorCode && (
                          <span className="text-[10px] font-mono text-red-400/80 block mt-0.5">
                            Code: {errorCode}
                          </span>
                        )}
                      </div>
                    </div>
                    {retryHint && (
                      <div className="pt-2 border-t border-red-500/20 text-xs text-red-200/90 flex items-start gap-1.5">
                        <Info className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{retryHint}</span>
                      </div>
                    )}
                  </div>

                  {/* Retry & Logout Options */}
                  <div className="pt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={handleTryAgain}
                      className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Try Again
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="py-3 px-4 bg-slate-700/60 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* User Identity Footer */}
        {user.name && (
          <p className="text-center text-xs text-slate-500">
            Authenticated as <span className="font-semibold text-slate-400">{user.name}</span>{' '}
            ({user.student_id || 'Student ID: Verified'})
          </p>
        )}
      </div>
    </div>
  );
}
