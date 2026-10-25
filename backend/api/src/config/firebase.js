// backend/api/src/config/firebase.js

import admin from 'firebase-admin';
import logger from '../middleware/logger.js';

let firebaseApp = null;

export function initializeFirebase() {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountVar) {
      const serviceAccount = JSON.parse(
        serviceAccountVar.startsWith('{')
          ? serviceAccountVar
          : Buffer.from(serviceAccountVar, 'base64').toString('utf8')
      );

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      logger.info('Firebase Admin SDK initialized successfully via service account credentials.');
    } else if (process.env.FIREBASE_PROJECT_ID) {
      firebaseApp = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
      logger.info('Firebase Admin SDK initialized via default project ID.');
    } else {
      logger.warn('FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID not set. Firebase Auth initialized in fallback mode.');
      firebaseApp = admin.initializeApp();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Firebase Admin SDK');
  }

  return firebaseApp;
}

export const firebaseAuth = () => {
  if (!admin.apps.length) {
    initializeFirebase();
  }
  return admin.auth();
};
