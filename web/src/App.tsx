import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import FacultyDashboard from './pages/FacultyDashboard';
import FacultyPresentation from './pages/FacultyPresentation';
import StudentCapture from './pages/StudentCapture';
import FacultyReview from './pages/FacultyReview';
import FacultyAttendance from './pages/FacultyAttendance';
import FacultySubjectHistory from './pages/FacultySubjectHistory';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/faculty/dashboard" element={<FacultyDashboard />} />
        <Route path="/session/:id" element={<FacultyPresentation />} />
        <Route path="/session/:id/review" element={<FacultyReview />} />
        <Route path="/session/:id/attendance" element={<FacultyAttendance />} />
        <Route path="/subjects/:id/history" element={<FacultySubjectHistory />} />
        <Route path="/student/capture" element={<StudentCapture />} />
      </Routes>
    </Router>
  );
}

export default App;