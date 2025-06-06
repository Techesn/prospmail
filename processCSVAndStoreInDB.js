require('dotenv').config(); // Load environment variables
const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient, ObjectId } = require('mongodb');
const readline = require('readline'); // Added readline
const { getRedirectedUrl } = require('./getRedirectionURL.js');
const { extractLatestJobDescription } = require('./extractLatestJobDescription.js');
const { 
    generateJobDescription, 
    generateSingleEmail,
    core_emails,
    personalization_prompts 
} = require('./emailGenerator.js');

// --- START OF CONFIGURATION ---
const LI_AT_COOKIE_VALUE = process.env.LI_AT_COOKIE_VALUE;
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = 'linkedin_data';
// const COLLECTION_NAME = 'profiles'; // Will be dynamic
const CSV_FILE_PATH = 'exportLGM.csv';
// --- END OF CONFIGURATION ---

// Helper function to get user input
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function processCSVAndStoreInDB() {
    console.log('Starting processCSVAndStoreInDB...');

    const collectionNameFromUser = await askQuestion('Enter the name for the MongoDB collection: ');
    if (!collectionNameFromUser || collectionNameFromUser.trim() === '') {
        console.error('Collection name cannot be empty. Exiting.');
        process.exit(1);
    }
    console.log(`Using collection: ${collectionNameFromUser}`);

    let client; // Declare client outside try to be accessible in finally
    let browser;
    let page;

    try {
        client = new MongoClient(MONGODB_URI); // Assign client here
        console.log(`Attempting to connect to MongoDB at ${MONGODB_URI}...`);
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        const database = client.db(DATABASE_NAME);
        const collection = database.collection(collectionNameFromUser); // Use user-provided name
        console.log(`Using database: ${DATABASE_NAME}, collection: ${collectionNameFromUser}`);

        let resumeSalesNavigatorUrl = null;
        let lastEntryIdToDelete = null;

        try {
            // Find the last document inserted by sorting _id in descending order
            const lastEntryArray = await collection.find().sort({_id: -1}).limit(1).toArray();
            if (lastEntryArray && lastEntryArray.length > 0) {
                const lastEntry = lastEntryArray[0];
                // Ensure salesNavigatorUrl exists on the last entry to be a valid resume point
                if (lastEntry.salesNavigatorUrl) {
                    resumeSalesNavigatorUrl = lastEntry.salesNavigatorUrl;
                    lastEntryIdToDelete = lastEntry._id; // This will be an ObjectId
                    console.log(`Found last processed entry in DB. Potential resume/reprocess point: ${resumeSalesNavigatorUrl} (DB ID: ${lastEntryIdToDelete})`);
                } else {
                    console.log("Last entry in DB does not have a salesNavigatorUrl. Cannot determine resume point. Processing from start.");
                }
            } else {
                console.log("No previous entries found in DB or collection is empty. Processing CSV from the beginning.");
            }
        } catch (dbError) {
            console.error("Error trying to find last entry in DB for resume capability:", dbError);
            resumeSalesNavigatorUrl = null; // Reset on error to process from start
            lastEntryIdToDelete = null;
        }

        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({ 
            headless: true,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--window-size=1920,1080'
            ]
        });
        console.log('Puppeteer launched in headless mode.');
        page = await browser.newPage();
        console.log('Puppeteer page created and will be reused.');

        // Wrap stream processing in a Promise
        await new Promise((resolve, reject) => {
            const results = [];
            const stream = fs.createReadStream(CSV_FILE_PATH)
                .on('error', (err) => {
                    console.error('Error reading CSV file stream:', err);
                    // No need to close browser/client here, finally block will handle it
                    reject(err); // Reject the promise on stream error
                })
                .pipe(csv())
                .on('data', (data) => {
                    results.push(data);
                })
                .on('end', async () => {
                    try {
                        console.log(`Finished reading CSV. Found ${results.length} rows.`);
                        if (results.length === 0) {
                            console.warn('CSV file might be empty or not parsed correctly.');
                            // No need to close browser/client here, finally block will handle it
                            resolve(); // Resolve the promise if CSV is empty after handling
                            return;
                        }

                        let startIndex = 0; // Default to starting from the beginning of the CSV

                        if (resumeSalesNavigatorUrl && lastEntryIdToDelete) {
                            console.log(`Attempting to find resume point: ${resumeSalesNavigatorUrl} in the loaded CSV data.`);
                            // Find the index in the CSV 'results' array that matches the resumeSalesNavigatorUrl
                            const resumeCsvIndex = results.findIndex(row => row['linkedinUrl'] === resumeSalesNavigatorUrl);

                            if (resumeCsvIndex !== -1) {
                                console.log(`Prospect ${resumeSalesNavigatorUrl} (from last DB entry) found in CSV at index ${resumeCsvIndex}.`);
                                try {
                                    console.log(`Attempting to delete previous incomplete DB entry with ID: ${lastEntryIdToDelete}...`);
                                    const deleteResult = await collection.deleteOne({ _id: lastEntryIdToDelete });
                                    if (deleteResult.deletedCount === 1) {
                                        console.log("Successfully deleted incomplete DB entry. Resuming processing from this prospect.");
                                        startIndex = resumeCsvIndex; // Set the CSV loop to start from this prospect
                                    } else {
                                        console.warn(`Failed to delete the last DB entry (ID: ${lastEntryIdToDelete}), or it was already deleted. Count: ${deleteResult.deletedCount}. Processing CSV from the beginning to ensure data integrity.`);
                                        startIndex = 0; // Fallback to start if deletion fails
                                    }
                                } catch (dbError) {
                                    console.error("Error occurred while deleting last DB entry for resume:", dbError);
                                    console.warn("Proceeding to process CSV from the beginning due to error during DB cleanup.");
                                    startIndex = 0; // Fallback to start on error
                                }
                            } else {
                                console.warn(`Prospect with salesNavigatorUrl ${resumeSalesNavigatorUrl} (from last DB entry) was NOT found in the current CSV. This could mean the CSV is different or the entry was fully processed and then script stopped. Processing CSV from the beginning.`);
                                startIndex = 0; // Fallback to start if prospect not in current CSV
                            }
                        } else if (lastEntryIdToDelete) {
                             console.log("A last DB entry ID was found, but no resumeSalesNavigatorUrl. This shouldn't happen if logic is correct. Processing from start to be safe.");
                        }

                        console.log(`Starting main processing loop from CSV index: ${startIndex}`);

                        // Adjusted loop to use startIndex
                        for (let i = startIndex; i < results.length; i++) {
                            const row = results[i];
                            console.log(`Processing prospect ${i + 1}/${results.length} (CSV index ${i})... Data:`, {firstName: row['firstname'], lastName: row['lastname'], url: row['linkedinUrl']});
                            
                            const salesNavigatorUrl = row['linkedinUrl'];
                            const firstName = row['firstname'];
                            const lastName = row['lastname'];
                            const jobTitle = row['jobTitle'];
                            const companyName = row['companyName'];
                            const emailAddress = row['email'] || row['Email'] || null;

                            if (!salesNavigatorUrl) {
                                console.warn('linkedinUrl is missing for a row:', row);
                                const errorData = {
                                    firstName: row['firstname'],
                                    lastName: row['lastname'],
                                    jobTitle: row['jobTitle'],
                                    companyName: row['companyName'],
                                    email: emailAddress,
                                    salesNavigatorUrl: null,
                                    linkedinUrl: null,
                                    latestJobDescription: null,
                                    technicalSkills: [],
                                    generatedEmails: [],
                                    error: 'Missing salesNavigatorUrl in CSV',
                                    processedAt: new Date()
                                };
                                try {
                                    await collection.insertOne(errorData);
                                    console.log(`Inserted error record for missing URL: ${row['firstname']} ${row['lastname']}`);
                                } catch (dbError) {
                                    console.error(`Error inserting error data (missing URL) for ${row['firstname']} ${row['lastname']} into MongoDB: `, dbError);
                                }
                                continue;
                            }

                            let classicUrl = null;
                            let navigationResult = null;
                            const maxRetries = 3;
                            let currentRetry = 0;

                            while (currentRetry < maxRetries) {
                                console.log(`Attempt ${currentRetry + 1}/${maxRetries} to get classic URL for: ${salesNavigatorUrl}`);
                                if (!page || page.isClosed()) { // Check if page is closed before using
                                    console.warn(`Page was closed before processing ${salesNavigatorUrl}. Attempting to reopen.`);
                                    if (browser && browser.isConnected()) {
                                        page = await browser.newPage();
                                        console.log('New page opened.');
                                    } else {
                                        console.error('Browser is not connected. Cannot open new page.');
                                        navigationResult.error = new Error('Browser not connected');
                                        break;
                                    }
                                }
                                navigationResult = await getRedirectedUrl(salesNavigatorUrl, page, LI_AT_COOKIE_VALUE);

                                if (navigationResult.url) {
                                    classicUrl = navigationResult.url;
                                    break; // Success
                                } else if (navigationResult.error && navigationResult.error.message.includes('Navigation timeout')) {
                                    currentRetry++;
                                    console.warn(`Navigation timeout for ${salesNavigatorUrl}. Attempt ${currentRetry}/${maxRetries}.`);
                                    if (currentRetry >= maxRetries) {
                                        console.error(`All ${maxRetries} retries failed for ${salesNavigatorUrl} due to navigation timeout.`);
                                        break;
                                    }
                                    try {
                                        if (page && !page.isClosed()) { // Check before closing
                                            console.log('Closing current page due to navigation timeout...');
                                            await page.close();
                                        }
                                        // Browser is not closed here, a new page will be created
                                        if (browser && browser.isConnected()) { // Check if browser is still connected
                                            console.log('Creating new page for retry...');
                                            page = await browser.newPage(); // Re-assign page
                                            console.log('New page created. Retrying navigation...');
                                        } else {
                                            console.error('Browser not connected, cannot create new page for retry.');
                                            // navigationResult.error = new Error('Browser disconnected during retry.'); // already set by getRedirectedUrl or similar
                                            break; // Critical error, cannot continue for this URL
                                        }
                                    } catch (restartError) { // This catch is for errors during page recreation
                                        console.error('Critical error during page recreation for retry:', restartError);
                                        navigationResult.error = restartError;
                                        break;
                                    }
                                } else {
                                    // Non-retryable error or invalid URL from the start
                                    console.warn(`Failed to get classic URL for ${salesNavigatorUrl}. Error: ${navigationResult.error ? navigationResult.error.message : 'Unknown error or invalid URL'}`);
                                    break; // Break for non-timeout errors or if URL was invalid from the start
                                }
                            }
                            
                            let jobData = { description: null, technicalSkills: [] };
                            let generatedEmails = [];

                            if (classicUrl) {
                                console.log(`Successfully obtained classic URL: ${classicUrl}`);
                                if (!page || page.isClosed()) { // Check page before use
                                    console.warn(`Page was closed before extracting job description for ${classicUrl}. Attempting to reopen.`);
                                    if (browser && browser.isConnected()) {
                                        page = await browser.newPage();
                                        console.log(`Navigating to ${classicUrl} on new page.`);
                                        await page.goto(classicUrl, { waitUntil: 'networkidle2' }); // Navigate to the classic URL
                                    } else {
                                        console.error('Browser is not connected. Cannot process further for this URL.');
                                        // Skip to next profile or handle as error
                                        classicUrl = null; // Mark as failed to prevent further processing
                                    }
                                }
                                if (classicUrl && page && !page.isClosed()){ // Re-check classicUrl and page
                                    console.log('Waiting 6000ms before attempting to extract job description...');
                                    await new Promise(resolve => setTimeout(resolve, 6000));
                                    jobData = await extractLatestJobDescription(page);

                                    if (!jobData || !jobData.description || jobData.description.toLowerCase().includes('aucune description') || jobData.description.trim() === '') {
                                        console.log(`Job description is missing or inadequate for ${firstName} ${lastName}. Generating...`);
                                        if (!jobData) jobData = { description: null, technicalSkills: [] };
                                        jobData.description = await generateJobDescription(jobTitle, companyName);
                                        console.log(`Generated job description for ${firstName} ${lastName}: ${jobData.description ? jobData.description.substring(0,100) : 'N/A'}...`);
                                    }

                                    const prospectDataForEmail = {
                                        prenom: firstName,
                                        nom: lastName,
                                        poste: jobTitle,
                                        entreprise: companyName,
                                        descriptionPoste: jobData.description,
                                        technicalSkills: jobData.technicalSkills
                                    };
                                    console.log(`Generating emails for ${firstName} ${lastName}...`);
                                    for (let k = 0; k < core_emails.length; k++) { // Changed loop variable to k
                                        console.log(`  Generating email ${k + 1}/${core_emails.length}...`);
                                        const emailContent = await generateSingleEmail(prospectDataForEmail, core_emails[k], personalization_prompts[k]);
                                        generatedEmails.push({
                                            sequence: k + 1,
                                            sujet: emailContent.sujet,
                                            contenu: emailContent.contenu,
                                            generatedAt: new Date()
                                        });
                                    }
                                    console.log(`${generatedEmails.length} emails generated for ${firstName} ${lastName}.`);
                                    const profileData = {
                                        firstName,
                                        lastName,
                                        jobTitle,
                                        companyName,
                                        email: emailAddress,
                                        salesNavigatorUrl,
                                        linkedinUrl: classicUrl,
                                        latestJobDescription: jobData.description,
                                        technicalSkills: jobData.technicalSkills,
                                        generatedEmails: generatedEmails,
                                        processedAt: new Date()
                                    };
                                    try {
                                        await collection.insertOne(profileData);
                                        console.log(`Inserted: ${firstName} ${lastName} - ${classicUrl}`);
                                    } catch (dbError) {
                                        console.error(`Error inserting data for ${firstName} ${lastName} into MongoDB: `, dbError);
                                    }
                                }
                            } else {
                                console.warn(`Could not retrieve classic URL for: ${salesNavigatorUrl} after all attempts or due to a non-retryable error.`);
                                const errorReason = navigationResult && navigationResult.error ? navigationResult.error.message : 'Failed to retrieve classic URL after retries or due to non-retryable/initial invalid URL';
                                const errorData = {
                                    firstName,
                                    lastName,
                                    jobTitle,
                                    companyName,
                                    email: emailAddress,
                                    salesNavigatorUrl,
                                    linkedinUrl: null, 
                                    latestJobDescription: null,
                                    technicalSkills: [],
                                    generatedEmails: [],
                                    error: errorReason,
                                    processedAt: new Date()
                                };
                                try {
                                    await collection.insertOne(errorData);
                                    console.log(`Inserted error record for: ${firstName} ${lastName} (Reason: ${errorReason})`);
                                } catch (dbError) {
                                    console.error(`Error inserting error data for ${firstName} ${lastName} into MongoDB: `, dbError);
                                }
                            }
                            console.log('Waiting for 1000ms before next row...');
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        console.log('All rows processed.');
                        resolve(); // Resolve the promise when all processing is done
                    } catch (loopError) {
                        console.error('Error within the CSV processing loop (.on end):', loopError);
                        reject(loopError); // Reject the promise on loop error
                    }
                });
        }); // End of new Promise for stream processing

        console.log('Stream processing Promise resolved. Main try block is ending.');

    } catch (error) {
        console.error('An critical error occurred in processCSVAndStoreInDB:', error);
        if (browser) {
            console.log('Closing browser due to error...');
            await browser.close();
        }
        if (client && client.topology && client.topology.isConnected()) { // Check if client is connected before closing
            console.log('Closing MongoDB connection due to error...');
            await client.close();
        }
        process.exit(1);
    } finally {
        console.log('Executing finally block...');
        if (page && !page.isClosed()) {
            console.log('Closing Puppeteer page in finally block...');
            await page.close().catch(err => console.error('Error closing page in finally:', err));
        }
        if (browser && browser.isConnected()) {
            console.log('Closing Puppeteer browser in finally block...');
            await browser.close().catch(err => console.error('Error closing browser in finally:', err));
        }
        if (client && client.topology && client.topology.isConnected()) {
            console.log('Closing MongoDB connection in finally block...');
            await client.close().catch(err => console.error('Error closing MongoDB connection in finally:', err));
        }
        console.log('Cleanup in finally block finished.');
    }
}

module.exports = { 
    processCSVAndStoreInDB, 
    MONGODB_URI,
    DATABASE_NAME, 
    CSV_FILE_PATH 
}; 