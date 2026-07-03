/**
 * Firebase Configuration
 * MindfulDay - Cross-Device Timer Sync
 * Project: mindfulday-gsb (owned by gs.bellu@gmail.com)
 */

const firebaseConfig = {
    apiKey: "AIzaSyBlLidQHcn4PQtW1v-tYlFLkT12NSTtdzY",
    authDomain: "mindfulday-gsb.firebaseapp.com",
    databaseURL: "https://mindfulday-gsb-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mindfulday-gsb",
    storageBucket: "mindfulday-gsb.firebasestorage.app",
    messagingSenderId: "1059960082784",
    appId: "1:1059960082784:web:ef86b745435a51bb6a8e05"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Realtime Database reference
const database = firebase.database();

// Export for use in app.js
window.firebaseDB = database;
