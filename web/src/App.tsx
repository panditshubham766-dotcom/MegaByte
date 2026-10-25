import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import FacultyDashboard from './pages/FacultyDashboard';
import FacultyPresentation from './pages/FacultyPresentation';
import StudentCapture from './pages/StudentCapture';
import FacultyReview from './pages/FacultyReview';
import FacultyAttendance from './pages/FacultyAttendance';
import FacultySubjectHistory from './pages/FacultySubjectHistory';
import ProtectedRoute from './components/ProtectedRoute';
import PageBackground from './components/PageBackground';

function App() {
  return (
    <Router>
      <PageBackground />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        
        {/* Protected Faculty Routes */}
        <Route path="/faculty/dashboard" element={<ProtectedRoute allowedRoles={['FACULTY']}><FacultyDashboard /></ProtectedRoute>} />
        <Route path="/session/:id" element={<ProtectedRoute allowedRoles={['FACULTY']}><FacultyPresentation /></ProtectedRoute>} />
        <Route path="/session/:id/review" element={<ProtectedRoute allowedRoles={['FACULTY']}><FacultyReview /></ProtectedRoute>} />
        <Route path="/session/:id/attendance" element={<ProtectedRoute allowedRoles={['FACULTY']}><FacultyAttendance /></ProtectedRoute>} />
        <Route path="/subjects/:id/history" element={<ProtectedRoute allowedRoles={['FACULTY']}><FacultySubjectHistory /></ProtectedRoute>} />
        
        {/* Protected Student Routes */}
        <Route path="/student/capture" element={<ProtectedRoute allowedRoles={['STUDENT']}><StudentCapture /></ProtectedRoute>} />
      </Routes>
    </Router>
  );
}

export default App;