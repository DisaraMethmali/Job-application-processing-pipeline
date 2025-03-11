// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAQNYXmNXks0tB3QW8HWQzWZJsqS8WRqP8",
  authDomain: "job-application-ba250.firebaseapp.com",
  projectId: "job-application-ba250",
  storageBucket: "job-application-ba250.firebasestorage.app",
  messagingSenderId: "343987470718",
  appId: "1:343987470718:web:c971b7bbd35da5606b732f",
  measurementId: "G-06SSJRQ1V8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);