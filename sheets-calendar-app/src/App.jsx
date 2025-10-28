import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { ThemeProvider, createTheme } from '@mui/material';

// Stores and hooks
import useAuthStore from './store/authStore';
import useFirebaseAuth from './hooks/useFirebaseAuth';

// Components
import Login from './components/Login';
import ControlCenter from './components/ControlCenterModern';
import Navbar from './components/Navbar';
import TodayView from './components/TodayView';
import ThreeDaysView from './components/ThreeDaysView';
import WeekView from './components/WeekView';
import MonthView from './components/MonthView';
import QuoteViewer from './components/QuoteViewer';

import './App.css';

// Dark theme configuration (matching ControlCenterModern)
const darkTheme = createTheme({
  direction: 'rtl',
  palette: {
    mode: 'dark',
    primary: {
      main: '#60a5fa', // Blue-400
      light: '#93c5fd',
      dark: '#3b82f6',
    },
    secondary: {
      main: '#a78bfa', // Purple-400
      light: '#c4b5fd',
      dark: '#8b5cf6',
    },
    background: {
      default: '#0f172a', // Slate-900
      paper: '#1e293b', // Slate-800
    },
    error: {
      main: '#f87171', // Red-400
    },
    success: {
      main: '#4ade80', // Green-400
    },
    text: {
      primary: '#f1f5f9', // Slate-100
      secondary: '#cbd5e1', // Slate-300
    },
  },
  typography: {
    fontFamily: '"Heebo", "Roboto", "Arial", sans-serif',
    h4: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(148, 163, 184, 0.1)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
        },
      },
    },
  },
});

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDDrZNaEaJB-3qoDe0EHMWdPEyvR1djY0o",
  authDomain: "sheet2cal-4fd7e.firebaseapp.com",
  projectId: "sheet2cal-4fd7e",
  storageBucket: "sheet2cal-4fd7e.firebasestorage.app",
  messagingSenderId: "774400049447",
  appId: "774400049447"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1'); // Specify region
const storage = getStorage(app);

// Make Firebase services available globally (for legacy components)
window.db = db;
window.auth = auth;
window.functions = functions;
window.storage = storage;

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuthStore();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Auth Wrapper Component
const AuthWrapper = ({ children }) => {
  const { setUser, setLoading } = useAuthStore();
  const [authError, setAuthError] = React.useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // Check if user is from hakolsound.co.il
        if (user.email && user.email.endsWith('@hakolsound.co.il')) {
          setUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          });
          setAuthError(null);
        } else {
          // Sign out if not from hakolsound.co.il
          signOut(auth);
          setAuthError('Only hakolsound.co.il organization members allowed');
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [setUser, setLoading]);

  return (
    <>
      {authError && <div className="auth-error">{authError}</div>}
      {children}
    </>
  );
};

function App() {
  const { user } = useAuthStore();

  return (
    <ThemeProvider theme={darkTheme}>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthWrapper>
            <div className="app">
              {user && <Navbar />}
              <div className="content">
                <Routes>
                <Route path="/login" element={<Login />} />

                {/* Quote routes */}
                <Route
                  path="/quotes/new"
                  element={
                    <ProtectedRoute>
                      <QuoteViewer />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/quotes/:quoteId"
                  element={
                    <ProtectedRoute>
                      <QuoteViewer />
                    </ProtectedRoute>
                  }
                />

                {/* Calendar view routes */}
                <Route
                  path="/today"
                  element={
                    <ProtectedRoute>
                      <TodayView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/3days"
                  element={
                    <ProtectedRoute>
                      <ThreeDaysView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/week"
                  element={
                    <ProtectedRoute>
                      <WeekView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/month"
                  element={
                    <ProtectedRoute>
                      <MonthView />
                    </ProtectedRoute>
                  }
                />

                {/* Control Center - combines Setup and Monitor */}
                <Route
                  path="/control"
                  element={
                    <ProtectedRoute>
                      <ControlCenter />
                    </ProtectedRoute>
                  }
                />
                {/* Legacy redirects */}
                <Route path="/setup" element={<Navigate to="/control" replace />} />
                <Route path="/monitor" element={<Navigate to="/control" replace />} />

                {/* Default redirect */}
                <Route
                  path="/"
                  element={<Navigate to={user ? "/today" : "/login"} replace />}
                />
              </Routes>
            </div>
          </div>
        </AuthWrapper>
      </Router>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#4caf50',
              secondary: '#fff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#f44336',
              secondary: '#fff',
            },
          },
        }}
      />
    </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
