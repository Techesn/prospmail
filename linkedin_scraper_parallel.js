require('dotenv').config(); // Load environment variables
const { processCSVAndStoreInDBParallel } = require('./processCSVAndStoreInDB_parallel.js');

// Check environment variables directly
if (process.env.LI_AT_COOKIE_VALUE === 'YOUR_LI_AT_COOKIE_HERE' || !process.env.LI_AT_COOKIE_VALUE || 
    process.env.MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE' || !process.env.MONGODB_URI) {
    console.error("---------------------------------------------------------------------");
    console.error("IMPORTANT: Please ensure LI_AT_COOKIE_VALUE and MONGODB_URI are set in your .env file.");
    console.error("---------------------------------------------------------------------");
    process.exit(1);
} else {
    console.log("🚀 Starting PARALLEL LinkedIn scraper with 3 Chrome instances...");
    console.log("This version will process 3 prospects simultaneously for faster execution.");
    console.log("---------------------------------------------------------------------");
    
    processCSVAndStoreInDBParallel().catch(error => {
        console.error("Critical error during parallel script execution:", error);
        process.exit(1);
    });
} 