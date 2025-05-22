const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
const { 
    processCSVAndStoreInDB,
    LI_AT_COOKIE_VALUE,
    MONGODB_URI 
} = require('./processCSVAndStoreInDB.js');

// The configuration constants like DATABASE_NAME, COLLECTION_NAME, CSV_FILE_PATH 
// are now self-contained within processCSVAndStoreInDB.js, so they are not needed here.

if (LI_AT_COOKIE_VALUE === 'YOUR_LI_AT_COOKIE_HERE' || MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
    console.error("---------------------------------------------------------------------");
    console.error("IMPORTANT: Please update LI_AT_COOKIE_VALUE and MONGODB_URI in ./processCSVAndStoreInDB.js.");
    console.error("---------------------------------------------------------------------");
} else {
    processCSVAndStoreInDB().catch(error => {
        console.error("Critical error during script execution:", error);
        process.exit(1);
    });
} 