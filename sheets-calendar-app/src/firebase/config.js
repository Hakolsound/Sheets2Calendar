// src/firebase/config.js
import { getApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';

// Get the existing Firebase app instance
const app = getApp();

// Initialize Cloud Storage from the existing app
const storage = getStorage(app);

export { storage };