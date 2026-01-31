/**
 * Firebase Configuration
 * MindfulDay - Cross-Device Timer Sync
 */

const firebaseConfig = {
    apiKey: "AIzaSyDOx53SKDfcs7R3nWkyp0fuCo9tCLYC4-Q",
    authDomain: "mindfulday-timer.firebaseapp.com",
    databaseURL: "https://mindfulday-timer-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mindfulday-timer",
    storageBucket: "mindfulday-timer.firebasestorage.app",
    messagingSenderId: "360483575254",
    appId: "1:360483575254:web:6fc909418e9188ac6a8077"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Realtime Database reference
const database = firebase.database();

// Export for use in app.js
window.firebaseDB = database;
