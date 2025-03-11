// src/services/firebase.js
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAQNYXmNXks0tB3QW8HWQzWZJsqS8WRqP8",
  authDomain: "job-application-ba250.firebaseapp.com",
  projectId: "job-application-ba250",
  storageBucket: "job-application-ba250.appspot.com",
  messagingSenderId: "343987470718",
  appId: "1:343987470718:web:c971b7bbd35da5606b732f",
  measurementId: "G-06SSJRQ1V8"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const analytics = getAnalytics(app);

// Export correctly
export { app, storage, analytics };
