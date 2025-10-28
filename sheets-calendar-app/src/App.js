// src/App.js - Updated with Firebase Storage
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage'; // Add Storage import

// Import existing components
import Login from './components/Login';
import SetupPage from './components/SetupPage';
import MonitorPage from './components/MonitorPage';
import Navbar from './components/Navbar';

// Import new view components
import TodayView from './components/TodayView';
import ThreeDaysView from './components/ThreeDaysView';
import WeekView from './components/WeekView';
import MonthView from './components/MonthView';

// Import quote viewer
import QuoteViewer from './components/QuoteViewer';

import './App.css';

// Firebase configuration - preserve existing config
const firebaseConfig = {
  apiKey: "AIzaSyDDrZNaEaJB-3qoDe0EHMWdPEyvR1djY0o",
  authDomain: "sheet2cal-4fd7e.firebaseapp.com",
  projectId: "sheet2cal-4fd7e",
  storageBucket: "sheet2cal-4fd7e.firebasestorage.app",
  messagingSenderId: "774400049447",
  appId: "774400049447"
};

// Initialize Firebase with v9 syntax
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const storage = getStorage(app); // Initialize Storage

// Make Firebase services available globally for easier access
window.db = db;
window.auth = auth;
window.functions = functions;
//window.storage = storage; // Make storage available globally
window.storage = getStorage(app);

function App() {
  // Rest of your component code remains the same
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        // Check if user is from hakolsound.co.il
        if (user.email && user.email.endsWith('@hakolsound.co.il')) {
          setUser(user);
          setAuthError(null);
        } else {
          // Sign out if not from hakolsound.co.il
          signOut(auth);
          setAuthError('Only hakolsound.co.il organization members allowed');
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Protected route component
  const ProtectedRoute = ({ component: Component, ...rest }) => (
    <Route
      {...rest}
      render={props =>
        user ? (
          <Component {...props} user={user} />
        ) : (
          <Redirect to="/login" />
        )
      }
    />
  );

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router>
      <div className="app">
        {user && <Navbar user={user} />}
        <div className="content">
          {authError && <div className="auth-error">{authError}</div>}
          <Switch>
            <Route 
              path="/login" 
              render={(props) => <Login {...props} authError={authError} />} 
            />
            
            {/* Quote routes */}
            <ProtectedRoute path="/quotes/new" component={QuoteViewer} />
            <ProtectedRoute path="/quotes/:quoteId" component={QuoteViewer} />
            
            {/* Calendar view routes */}
            <ProtectedRoute path="/today" component={TodayView} />
            <ProtectedRoute path="/3days" component={ThreeDaysView} />
            <ProtectedRoute path="/week" component={WeekView} />
            <ProtectedRoute path="/month" component={MonthView} />
            
            {/* Existing routes */}
            <ProtectedRoute path="/setup" component={SetupPage} />
            <ProtectedRoute path="/monitor" component={MonitorPage} />
            
            {/* Redirect to today view as default landing page when logged in */}
            <Redirect from="/" to={user ? "/today" : "/login"} />
          </Switch>
        </div>
      </div>
    </Router>
  );
}

export default App;