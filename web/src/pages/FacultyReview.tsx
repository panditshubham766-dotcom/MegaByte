import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, X, ArrowLeft, RefreshCw } from 'lucide-react';

interface PendingSubmission {
  record_id: string;
  name: string;
  student_id: string;
  photo_base64: string;
  status: string;
}

export default function FacultyReview() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPending = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/attendance/session/${sessionId}/pending`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch submissions');
      }
      
      const data = await response.json();
      setSubmissions(data);
      setError('');
    } catch (err: any) {
      console.error(err);
      setError('Connection error while fetching submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
    const interval = setInterval(() => {
      fetchPending();
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId]);

  const handleReview = async (recordId: string, status: 'APPROVED' | 'REJECTED') => {
    // Optimistic UI update
    setSubmissions(prev => prev.filter(sub => sub.record_id !== recordId));
    
    try {
      const token = localStorage.getItem('token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const response = await fetch(`${API_URL}/api/attendance/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ record_id: recordId, status })
      });

      if (!response.ok) {
        // If it fails, we fetch the list again to restore the UI state
        fetchPending();
      }
    } catch (err) {
      console.error('Error reviewing submission:', err);
      fetchPending();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/faculty/dashboard')}
              className="p-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-gray-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Live Review Dashboard</h1>
          </div>
          <div className="flex items-center text-gray-500 text-sm bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200">
            <RefreshCw className="h-4 w-4 mr-2 animate-spin-slow" />
            Live Polling Active
          </div>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-6">
            {error}
          </div>
        )}

        {loading && submissions.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            <div className="mx-auto w-24 h-24 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <Check className="h-10 w-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-medium text-gray-900 mb-1">All caught up!</h3>
            <p>Waiting for new student submissions...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {submissions.map((sub) => (
              <div key={sub.record_id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-gray-100 w-full relative">
                  {sub.photo_base64 ? (
                    <img 
                      src={sub.photo_base64} 
                      alt={`Photo of ${sub.name}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      No Photo
                    </div>
                  )}
                </div>
                <div className="p-4 flex-grow flex flex-col">
                  <h3 className="font-bold text-lg text-gray-900 truncate">{sub.name}</h3>
                  <p className="text-sm text-gray-500 mb-4 truncate">{sub.student_id || 'No ID Provided'}</p>
                  
                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <button
                      onClick={() => handleReview(sub.record_id, 'REJECTED')}
                      className="flex items-center justify-center py-2 px-3 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium text-sm"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleReview(sub.record_id, 'APPROVED')}
                      className="flex items-center justify-center py-2 px-3 border border-transparent text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors font-medium text-sm shadow-sm"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
