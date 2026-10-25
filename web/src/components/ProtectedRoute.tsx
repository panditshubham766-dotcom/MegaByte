import React from 'react';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactElement;
  allowedRoles?: ('FACULTY' | 'STUDENT')[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const token = localStorage.getItem('token');
  const userJson = localStorage.getItem('user');

  if (!token || !userJson) {
    return <Navigate to="/login" replace />;
  }

  try {
    const user = JSON.parse(userJson);
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      if (user.role === 'FACULTY') {
        return <Navigate to="/faculty/dashboard" replace />;
      }
      return <Navigate to="/student/capture" replace />;
    }
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return <Navigate to="/login" replace />;
  }

  return children;
}
