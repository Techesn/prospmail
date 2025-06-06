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
const CSV_FILE_PATH = 'exportLGM.csv';
const PARALLEL_WORKERS = 3; // Nombre d'instances Chrome en parallèle
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

// Fonction pour diviser un tableau en chunks
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Fonction pour traiter un prospect unique
async function processProspect(row, page, collection, LI_AT_COOKIE_VALUE, workerId) {
    console.log(`[Worker ${workerId}] Processing prospect: ${row['firstname']} ${row['lastname']}`);
    
    const salesNavigatorUrl = row['linkedinUrl'];
    const firstName = row['firstname'];
    const lastName = row['lastname'];
    const jobTitle = row['jobTitle'];
    const companyName = row['companyName'];
    const emailAddress = row['email'] || row['Email'] || null;

    if (!salesNavigatorUrl) {
        console.warn(`[Worker ${workerId}] linkedinUrl is missing for: ${firstName} ${lastName}`);
        const errorData = {
            firstName,
            lastName,
            jobTitle,
            companyName,
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
            console.log(`[Worker ${workerId}] Inserted error record for missing URL: ${firstName} ${lastName}`);
        } catch (dbError) {
            console.error(`[Worker ${workerId}] Error inserting error data (missing URL) for ${firstName} ${lastName}: `, dbError);
        }
        return;
    }

    let classicUrl = null;
    let navigationResult = null;
    const maxRetries = 3;
    let currentRetry = 0;

    while (currentRetry < maxRetries) {
        console.log(`[Worker ${workerId}] Attempt ${currentRetry + 1}/${maxRetries} to get classic URL for: ${salesNavigatorUrl}`);
        if (!page || page.isClosed()) {
            console.warn(`[Worker ${workerId}] Page was closed. This shouldn't happen with worker architecture.`);
            return;
        }
        
        navigationResult = await getRedirectedUrl(salesNavigatorUrl, page, LI_AT_COOKIE_VALUE);

        if (navigationResult.url) {
            classicUrl = navigationResult.url;
            break; // Success
        } else if (navigationResult.error && navigationResult.error.message.includes('Navigation timeout')) {
            currentRetry++;
            console.warn(`[Worker ${workerId}] Navigation timeout for ${salesNavigatorUrl}. Attempt ${currentRetry}/${maxRetries}.`);
            if (currentRetry >= maxRetries) {
                console.error(`[Worker ${workerId}] All ${maxRetries} retries failed for ${salesNavigatorUrl} due to navigation timeout.`);
                break;
            }
            // Attendre un peu avant de réessayer
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            console.warn(`[Worker ${workerId}] Failed to get classic URL for ${salesNavigatorUrl}. Error: ${navigationResult.error ? navigationResult.error.message : 'Unknown error'}`);
            break;
        }
    }
    
    let jobData = { description: null, technicalSkills: [] };
    let generatedEmails = [];

    if (classicUrl) {
        console.log(`[Worker ${workerId}] Successfully obtained classic URL: ${classicUrl}`);
        
        console.log(`[Worker ${workerId}] Waiting 6000ms before attempting to extract job description...`);
        await new Promise(resolve => setTimeout(resolve, 6000));
        jobData = await extractLatestJobDescription(page);

        if (!jobData || !jobData.description || jobData.description.toLowerCase().includes('aucune description') || jobData.description.trim() === '') {
            console.log(`[Worker ${workerId}] Job description is missing or inadequate for ${firstName} ${lastName}. Generating...`);
            if (!jobData) jobData = { description: null, technicalSkills: [] };
            jobData.description = await generateJobDescription(jobTitle, companyName);
            console.log(`[Worker ${workerId}] Generated job description for ${firstName} ${lastName}: ${jobData.description ? jobData.description.substring(0,100) : 'N/A'}...`);
        }

        const prospectDataForEmail = {
            prenom: firstName,
            nom: lastName,
            poste: jobTitle,
            entreprise: companyName,
            descriptionPoste: jobData.description,
            technicalSkills: jobData.technicalSkills
        };
        
        console.log(`[Worker ${workerId}] Generating emails for ${firstName} ${lastName}...`);
        for (let k = 0; k < core_emails.length; k++) {
            console.log(`[Worker ${workerId}]   Generating email ${k + 1}/${core_emails.length}...`);
            const emailContent = await generateSingleEmail(prospectDataForEmail, core_emails[k], personalization_prompts[k]);
            generatedEmails.push({
                sequence: k + 1,
                sujet: emailContent.sujet,
                contenu: emailContent.contenu,
                generatedAt: new Date()
            });
        }
        console.log(`[Worker ${workerId}] ${generatedEmails.length} emails generated for ${firstName} ${lastName}.`);
        
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
            console.log(`[Worker ${workerId}] Inserted: ${firstName} ${lastName} - ${classicUrl}`);
        } catch (dbError) {
            console.error(`[Worker ${workerId}] Error inserting data for ${firstName} ${lastName} into MongoDB: `, dbError);
        }
    } else {
        console.warn(`[Worker ${workerId}] Could not retrieve classic URL for: ${salesNavigatorUrl} after all attempts`);
        const errorReason = navigationResult && navigationResult.error ? navigationResult.error.message : 'Failed to retrieve classic URL after retries';
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
            console.log(`[Worker ${workerId}] Inserted error record for: ${firstName} ${lastName} (Reason: ${errorReason})`);
        } catch (dbError) {
            console.error(`[Worker ${workerId}] Error inserting error data for ${firstName} ${lastName} into MongoDB: `, dbError);
        }
    }
    
    // Petite pause entre les prospects pour éviter de surcharger LinkedIn
    console.log(`[Worker ${workerId}] Waiting for 1000ms before next prospect...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
}

// Fonction worker qui traite un chunk de prospects
async function processWorker(workerId, prospects, collection) {
    console.log(`[Worker ${workerId}] Starting with ${prospects.length} prospects to process`);
    
    let browser;
    let page;
    
    try {
        // Créer une instance Chrome dédiée pour ce worker
        console.log(`[Worker ${workerId}] Launching Puppeteer...`);
        browser = await puppeteer.launch({ 
            headless: true,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--window-size=1920,1080',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        console.log(`[Worker ${workerId}] Puppeteer launched in headless mode.`);
        page = await browser.newPage();
        console.log(`[Worker ${workerId}] Puppeteer page created.`);

        // Traiter chaque prospect de ce worker séquentiellement
        for (let i = 0; i < prospects.length; i++) {
            const prospect = prospects[i];
            console.log(`[Worker ${workerId}] Processing prospect ${i + 1}/${prospects.length}`);
            await processProspect(prospect, page, collection, LI_AT_COOKIE_VALUE, workerId);
        }
        
        console.log(`[Worker ${workerId}] Completed all prospects`);
        
    } catch (error) {
        console.error(`[Worker ${workerId}] Critical error:`, error);
    } finally {
        // Nettoyer les ressources du worker
        if (page && !page.isClosed()) {
            console.log(`[Worker ${workerId}] Closing page...`);
            await page.close().catch(err => console.error(`[Worker ${workerId}] Error closing page:`, err));
        }
        if (browser && browser.isConnected()) {
            console.log(`[Worker ${workerId}] Closing browser...`);
            await browser.close().catch(err => console.error(`[Worker ${workerId}] Error closing browser:`, err));
        }
        console.log(`[Worker ${workerId}] Cleanup completed`);
    }
}

async function processCSVAndStoreInDBParallel() {
    console.log('Starting parallel processCSVAndStoreInDB...');

    const collectionNameFromUser = await askQuestion('Enter the name for the MongoDB collection: ');
    if (!collectionNameFromUser || collectionNameFromUser.trim() === '') {
        console.error('Collection name cannot be empty. Exiting.');
        process.exit(1);
    }
    console.log(`Using collection: ${collectionNameFromUser}`);

    let client;

    try {
        // Connexion MongoDB
        client = new MongoClient(MONGODB_URI);
        console.log(`Attempting to connect to MongoDB at ${MONGODB_URI}...`);
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        const database = client.db(DATABASE_NAME);
        const collection = database.collection(collectionNameFromUser);
        console.log(`Using database: ${DATABASE_NAME}, collection: ${collectionNameFromUser}`);

        // Gestion du point de reprise (comme dans l'original)
        let resumeSalesNavigatorUrl = null;
        let lastEntryIdToDelete = null;

        try {
            const lastEntryArray = await collection.find().sort({_id: -1}).limit(1).toArray();
            if (lastEntryArray && lastEntryArray.length > 0) {
                const lastEntry = lastEntryArray[0];
                if (lastEntry.salesNavigatorUrl) {
                    resumeSalesNavigatorUrl = lastEntry.salesNavigatorUrl;
                    lastEntryIdToDelete = lastEntry._id;
                    console.log(`Found last processed entry in DB. Potential resume/reprocess point: ${resumeSalesNavigatorUrl} (DB ID: ${lastEntryIdToDelete})`);
                } else {
                    console.log("Last entry in DB does not have a salesNavigatorUrl. Cannot determine resume point. Processing from start.");
                }
            } else {
                console.log("No previous entries found in DB or collection is empty. Processing CSV from the beginning.");
            }
        } catch (dbError) {
            console.error("Error trying to find last entry in DB for resume capability:", dbError);
            resumeSalesNavigatorUrl = null;
            lastEntryIdToDelete = null;
        }

        // Lecture du CSV
        const results = await new Promise((resolve, reject) => {
            const csvResults = [];
            fs.createReadStream(CSV_FILE_PATH)
                .on('error', (err) => {
                    console.error('Error reading CSV file stream:', err);
                    reject(err);
                })
                .pipe(csv())
                .on('data', (data) => {
                    csvResults.push(data);
                })
                .on('end', () => {
                    console.log(`Finished reading CSV. Found ${csvResults.length} rows.`);
                    resolve(csvResults);
                });
        });

        if (results.length === 0) {
            console.warn('CSV file might be empty or not parsed correctly.');
            return;
        }

        // Déterminer le point de départ (gestion de reprise)
        let startIndex = 0;
        if (resumeSalesNavigatorUrl && lastEntryIdToDelete) {
            console.log(`Attempting to find resume point: ${resumeSalesNavigatorUrl} in the loaded CSV data.`);
            const resumeCsvIndex = results.findIndex(row => row['linkedinUrl'] === resumeSalesNavigatorUrl);

            if (resumeCsvIndex !== -1) {
                console.log(`Prospect ${resumeSalesNavigatorUrl} found in CSV at index ${resumeCsvIndex}.`);
                try {
                    console.log(`Attempting to delete previous incomplete DB entry with ID: ${lastEntryIdToDelete}...`);
                    const deleteResult = await collection.deleteOne({ _id: lastEntryIdToDelete });
                    if (deleteResult.deletedCount === 1) {
                        console.log("Successfully deleted incomplete DB entry. Resuming processing from this prospect.");
                        startIndex = resumeCsvIndex;
                    } else {
                        console.warn(`Failed to delete the last DB entry. Processing CSV from the beginning.`);
                        startIndex = 0;
                    }
                } catch (dbError) {
                    console.error("Error occurred while deleting last DB entry for resume:", dbError);
                    startIndex = 0;
                }
            } else {
                console.warn(`Prospect with salesNavigatorUrl ${resumeSalesNavigatorUrl} was NOT found in the current CSV. Processing from beginning.`);
                startIndex = 0;
            }
        }

        // Extraire les prospects à traiter
        const prospectsToProcess = results.slice(startIndex);
        console.log(`Total prospects to process: ${prospectsToProcess.length} (starting from index ${startIndex})`);

        // Diviser en chunks pour les workers
        const prospectsPerWorker = Math.ceil(prospectsToProcess.length / PARALLEL_WORKERS);
        const chunks = chunkArray(prospectsToProcess, prospectsPerWorker);
        
        console.log(`Dividing ${prospectsToProcess.length} prospects into ${chunks.length} chunks for ${PARALLEL_WORKERS} workers:`);
        chunks.forEach((chunk, index) => {
            console.log(`  Worker ${index + 1}: ${chunk.length} prospects`);
        });

        // Lancer les workers en parallèle
        console.log(`Starting ${chunks.length} parallel workers...`);
        const workerPromises = chunks.map((chunk, index) => 
            processWorker(index + 1, chunk, collection)
        );

        // Attendre que tous les workers terminent
        await Promise.all(workerPromises);
        
        console.log('All parallel workers completed successfully!');

    } catch (error) {
        console.error('A critical error occurred in processCSVAndStoreInDBParallel:', error);
        process.exit(1);
    } finally {
        if (client && client.topology && client.topology.isConnected()) {
            console.log('Closing MongoDB connection...');
            await client.close().catch(err => console.error('Error closing MongoDB connection:', err));
        }
        console.log('Cleanup completed.');
    }
}

module.exports = { 
    processCSVAndStoreInDBParallel, 
    MONGODB_URI,
    DATABASE_NAME, 
    CSV_FILE_PATH 
}; 