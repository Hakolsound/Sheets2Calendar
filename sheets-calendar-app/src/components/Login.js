import React from 'react';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useHistory } from 'react-router-dom';
import GoogleButton from 'react-google-button';

function Login({ authError }) {
  const history = useHistory();
  const auth = getAuth();

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Ensure we get a refresh token
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
      history.push('/setup');
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Sheets to Calendar Sync</h1>
        <p>Sign in with your hakolsound.co.il Google account</p>
        <GoogleButton onClick={handleGoogleLogin} />
        {authError && <div className="error-message">{authError}</div>}
      </div>
    </div>
  );
}

export default Login;