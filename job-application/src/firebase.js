import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAQNYXmNXks0tB3QW8HWQzWZJsqS8WRqP8",
  authDomain: "job-application-ba250.firebaseapp.com",
  projectId: "job-application-ba250",
  storageBucket: "job-application-ba250.firebasestorage.app",
  messagingSenderId: "343987470718",
  appId: "1:343987470718:web:c971b7bbd35da5606b732f",
  measurementId: "G-06SSJRQ1V8"
};

// Initialize Firebase.
const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const storage = getStorage(app);
export const db = getFirestore(app);

export default app; 