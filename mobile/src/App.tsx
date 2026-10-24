import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Capture from './pages/Capture';
import MyAttendance from './pages/MyAttendance';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/verify" element={<Navigate to="/capture" replace />} />
        <Route path="/my-attendance" element={<MyAttendance />} />
        <Route path="/records" element={<Navigate to="/my-attendance" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
