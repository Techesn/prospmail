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

async function getRedirectedUrl(originalUrl, page) {
    if (!originalUrl || !originalUrl.startsWith('http')) {
        console.warn(`Skipping invalid URL: ${originalUrl}`);
        return { url: null, error: null }; // Return object
    }
    try {
        await page.setCookie({
            name: 'li_at',
            value: LI_AT_COOKIE_VALUE,
            domain: '.linkedin.com',
            path: '/',
            secure: true,
            httpOnly: true,
        });
        console.log(`Navigating to: ${originalUrl} using existing page...`);
        const response = await page.goto(originalUrl);
        console.log(`Waiting 2000ms for page to load after navigation to ${originalUrl}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const finalUrl = page.url();
        console.log(`Redirected to: ${finalUrl}`);
        return { url: finalUrl, error: null }; // Return object
    } catch (error) {
        console.error(`Error navigating to ${originalUrl}: ${error.message}`);
        return { url: null, error: error }; // Return object with error
    }
}

async function extractLatestJobDescription(page) {
    // ... existing code ...
} 