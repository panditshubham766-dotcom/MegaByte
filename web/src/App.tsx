import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import FacultyDashboard from './pages/FacultyDashboard';
import FacultyPresentation from './pages/FacultyPresentation';
import StudentCapture from './pages/StudentCapture';
import FacultyReview from './pages/FacultyReview';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/faculty/dashboard" element={<FacultyDashboard />} />
        <Route path="/faculty/presentation" element={<FacultyPresentation />} />
        <Route path="/faculty/review/:sessionId" element={<FacultyReview />} />
        <Route path="/student/capture" element={<StudentCapture />} />
      </Routes>
    </Router>
  );
}

export default App;