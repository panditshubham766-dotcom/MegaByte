import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

type Step = 'IDLE' | 'FETCHING' | 'LOOK_STRAIGHT' | 'TURN_HEAD' | 'SUBMITTING';

export default function StudentCapture() {
  const [sessionCode, setSessionCode] = useState('');
  const [step, setStep] = useState<Step>('IDLE');
  const [challengeAction, setChallengeAction] = useState<'TURN_LEFT' | 'TURN_RIGHT' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError('Failed to access camera. Please allow permissions.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  // Helper to capture raw un-mirrored frame at max 480px width, JPEG quality 0.7
  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;

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

  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

  const handleStartFaceCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionCode || sessionCode.length !== 6) {
      setError('Please enter a valid 6-character session code.');
      return;
    }

    setError('');
    setStep('FETCHING');

    const token = localStorage.getItem('token');
    const API_URL = import.meta.env.VITE_API_URL || '';

    try {
      // 1. Fetch challenge
      const challengeRes = await fetch(`${API_URL}/api/attendance/challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: sessionCode })
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

      // 2. Look straight (capture 2 frames over ~0.8s)
      setStep('LOOK_STRAIGHT');
      await sleep(350);
      const f1 = captureFrame();
      await sleep(400);
      const f2 = captureFrame();

      const frames: string[] = [f1, f2].filter(Boolean) as string[];

      // 3. Turn head instruction + capture 1 frame per 250ms for 3s (12 frames)
      setStep('TURN_HEAD');
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const frame = captureFrame();
        if (frame) frames.push(frame);
      }

      // 4. Submit attendance with frames
      setStep('SUBMITTING');
      const submitRes = await fetch(`${API_URL}/api/attendance/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          code: sessionCode,
          challengeId,
          frames
        })
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

      // Success
      setSuccess(true);
      stopCamera();

      // Auto logout after 3 seconds
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
      }, 3000);

    } catch (err: any) {
      setError(err.message || 'Face check failed');
      setStep('IDLE');
      setChallengeAction(null);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-green-50 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle className="h-24 w-24 text-green-500 mx-auto" />
          <h1 className="text-3xl font-bold text-green-800">Success!</h1>
          <p className="text-green-600 text-lg">Your attendance is pending faculty review.</p>
          <p className="text-sm text-green-500">Logging you out securely...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4 md:p-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Student Attendance</h2>
          <p className="text-gray-500 mt-2">Enter session code and complete the face liveness check</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm text-center font-medium shadow-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-200">
          <div className="relative aspect-[4/3] bg-black overflow-hidden">
            {/* Live preview is mirrored for natural UX, raw captures are un-mirrored */}
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ transform: 'scaleX(-1)' }}
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Instruction Banner Overlay */}
            {step === 'LOOK_STRAIGHT' && (
              <div className="absolute inset-x-0 top-4 mx-4 p-3 bg-blue-600/90 backdrop-blur-md rounded-xl text-white text-center font-bold text-base shadow-lg animate-pulse flex items-center justify-center gap-2">
                <span>👤</span>
                <span>Look straight at the camera</span>
              </div>
            )}

            {step === 'TURN_HEAD' && challengeAction && (
              <div className="absolute inset-x-0 top-4 mx-4 p-4 bg-amber-500/95 backdrop-blur-md rounded-xl text-white text-center font-extrabold text-lg shadow-xl animate-bounce flex items-center justify-center gap-2 border-2 border-white/50">
                {challengeAction === 'TURN_LEFT' ? (
                  <>
                    <ArrowLeft className="h-6 w-6" />
                    <span>Turn head to YOUR LEFT</span>
                    <ArrowLeft className="h-6 w-6" />
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-6 w-6" />
                    <span>Turn head to YOUR RIGHT</span>
                    <ArrowRight className="h-6 w-6" />
                  </>
                )}
              </div>
            )}

            {step === 'FETCHING' && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white space-y-3">
                <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
                <p className="font-semibold text-sm">Preparing face check...</p>
              </div>
            )}

            {step === 'SUBMITTING' && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white space-y-3">
                <Loader2 className="h-10 w-10 animate-spin text-green-400" />
                <p className="font-semibold text-sm">Verifying face & liveness...</p>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleStartFaceCheck} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Session Code
            </label>
            <input
              type="text"
              required
              disabled={step !== 'IDLE'}
              maxLength={6}
              placeholder="e.g. A1B2C3"
              className="appearance-none block w-full px-4 py-4 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-2xl text-center uppercase font-mono tracking-widest disabled:bg-gray-100"
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
            />
          </div>

          <button
            type="submit"
            disabled={step !== 'IDLE' || sessionCode.length !== 6}
            className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {step === 'IDLE' && (
              <>
                <Camera className="h-5 w-5 mr-2" />
                Start face check
              </>
            )}
            {step === 'FETCHING' && 'Getting challenge...'}
            {step === 'LOOK_STRAIGHT' && 'Looking straight...'}
            {step === 'TURN_HEAD' && 'Turning head...'}
            {step === 'SUBMITTING' && 'Verifying attendance...'}
          </button>
        </form>
      </div>
    </div>
  );
}
