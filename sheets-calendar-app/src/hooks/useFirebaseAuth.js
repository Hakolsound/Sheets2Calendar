import { useEffect } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import useAuthStore from '../store/authStore';

const useFirebaseAuth = () => {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // User is signed in
        setUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        });
      } else {
        // User is signed out
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, [setUser, setLoading]);
};

export default useFirebaseAuth;
