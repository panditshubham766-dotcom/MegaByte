import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Send, CheckCircle } from 'lucide-react';

export default function StudentCapture() {
  const [sessionCode, setSessionCode] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
        video: { facingMode: 'user' } 
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

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPhotoBase64(dataUrl);
      }
    }
  };

  const retakePhoto = () => {
    setPhotoBase64(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionCode || sessionCode.length !== 6) {
      setError('Please enter a valid 6-character session code.');
      return;
    }
    if (!photoBase64) {
      setError('Please capture a photo first.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/attendance/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          session_code: sessionCode, 
          photo_base64: photoBase64 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to submit attendance');
      }

      setSuccess(true);
      stopCamera();
      
      // Auto logout after 3 seconds
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
      }, 3000);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-4">
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
    <div className="min-h-screen bg-transparent flex flex-col p-4 md:p-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Student Attendance</h2>
          <p className="text-gray-500 mt-2">Enter code and take a photo to verify your identity</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm text-center">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
          <div className="relative aspect-[4/3] bg-black">
            {!photoBase64 ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover"
              />
            ) : (
              <img 
                src={photoBase64} 
                alt="Captured" 
                className="w-full h-full object-cover"
              />
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="p-4 flex justify-center bg-gray-50 border-t border-gray-100">
            {!photoBase64 ? (
              <button
                type="button"
                onClick={capturePhoto}
                className="flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-full text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
              >
                <Camera className="h-5 w-5 mr-2" />
                Capture Photo
              </button>
            ) : (
              <button
                type="button"
                onClick={retakePhoto}
                className="flex items-center justify-center px-6 py-3 border border-gray-300 shadow-sm text-base font-medium rounded-full text-gray-700 bg-white hover:bg-gray-50"
              >
                Retake Photo
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Session Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              placeholder="e.g. A1B2C3"
              className="appearance-none block w-full px-4 py-4 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-2xl text-center uppercase font-mono tracking-widest"
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !photoBase64 || sessionCode.length !== 6}
            className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="h-5 w-5 mr-2" />
            {loading ? 'Submitting...' : 'Submit Attendance'}
          </button>
        </form>
      </div>
    </div>
  );
}
