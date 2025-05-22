require('dotenv').config(); // Load environment variables
const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const { 
    processCSVAndStoreInDB,
    // LI_AT_COOKIE_VALUE, // No longer imported, check process.env directly
    // MONGODB_URI         // No longer imported, check process.env directly
} = require('./processCSVAndStoreInDB.js');

// The configuration constants like DATABASE_NAME, COLLECTION_NAME, CSV_FILE_PATH 
// are now self-contained within processCSVAndStoreInDB.js, so they are not needed here.

// Check environment variables directly
if (process.env.LI_AT_COOKIE_VALUE === 'YOUR_LI_AT_COOKIE_HERE' || !process.env.LI_AT_COOKIE_VALUE || 
    process.env.MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE' || !process.env.MONGODB_URI) {
    console.error("---------------------------------------------------------------------");
    console.error("IMPORTANT: Please ensure LI_AT_COOKIE_VALUE and MONGODB_URI are set in your .env file.");
    console.error("---------------------------------------------------------------------");
} else {
    processCSVAndStoreInDB().catch(error => {
        console.error("Critical error during script execution:", error);
        process.exit(1);
    });
} 