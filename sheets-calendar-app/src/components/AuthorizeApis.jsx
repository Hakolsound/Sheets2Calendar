import React, { useState } from 'react';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

function AuthorizeApis({ user, onComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Get Firebase service instances
  const auth = getAuth();
  const db = getFirestore();

  const handleAuthorize = async () => {
    setLoading(true);
    setError(null);
  
    try {
      // Create a Google OAuth client
      const provider = new GoogleAuthProvider();
      
      // Request the required scopes for Google Sheets and Calendar
      provider.addScope('https://www.googleapis.com/auth/spreadsheets');
      provider.addScope('https://www.googleapis.com/auth/calendar');
      
      // Force consent screen to get refresh token
      provider.setCustomParameters({
        prompt: 'consent',
        access_type: 'offline'
      });
      
      // Sign in and get credentials
      const result = await signInWithPopup(auth, provider);
      console.log("Auth result:", result);
      
      // Store a dummy token - Firebase popup doesn't return refresh tokens
      // We'll need to use a server-side OAuth flow for proper tokens
      const userCredentialRef = doc(db, 'userCredentials', user.uid);
      await setDoc(userCredentialRef, {
        accessToken: result._tokenResponse.oauthAccessToken,
        refreshToken: "temporary-token", // Firebase doesn't return refresh tokens via client-side auth
        createdAt: serverTimestamp()
      });
  
      // Notify parent component
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('OAuth error:', error);
      setError(`Authorization error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="authorize-container">
      <h2>API Authorization Required</h2>
      <p>
        To use this application, you need to authorize access to your Google Sheets and Calendar.
        This allows the app to read your sheets and create calendar events on your behalf.
      </p>
      
      {error && <div className="error-message">{error}</div>}
      
      <button 
        onClick={handleAuthorize} 
        disabled={loading} 
        className="authorize-button"
      >
        {loading ? 'Authorizing...' : 'Authorize API Access'}
      </button>
    </div>
  );
}

export default AuthorizeApis;