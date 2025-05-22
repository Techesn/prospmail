const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient, ObjectId } = require('mongodb');
const { getRedirectedUrl } = require('./getRedirectionURL.js');
const { extractLatestJobDescription } = require('./extractLatestJobDescription.js');
const { 
    generateJobDescription, 
    generateSingleEmail,
    core_emails,
    personalization_prompts 
} = require('./emailGenerator.js');

// --- START OF CONFIGURATION ---
const LI_AT_COOKIE_VALUE = 'AQEFARABAAAAABV-N78AAAGWgMRzRgAAAZcSgoR-TgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDdG5jU21pQ2FvK2RPSlloV1NKbk94QWhpbEYreS9nUm1SSnQrM2MzQUNBQ3J0Z2oyXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjExNjI2NzA0OSwxNDM0NDkyMDkpXnVybjpsaTptZW1iZXI6Njc5NzA5MzA1T3mLgJteDvy2DM7OalyRtf-2kuUjsUKQzyIsf8QhNA-kIv471ugOcCoEjsg1Ng181VjyqZM8JHU0jmuhhfk-lVAgsWYSu58QDSQNrXQa3YCE1GFvelbgLd82rRtYWnSVPxawvqOigbmvF2onBcVpsDRLWJVKYnlIC-LfoVF3O01oZ9D9ctGcfh7eUjqJEN1x0toTGA';
const MONGODB_URI = 'mongodb://localhost:27017';
const DATABASE_NAME = 'linkedin_data';
const COLLECTION_NAME = 'profiles';
const CSV_FILE_PATH = 'exportLGM.csv';
// --- END OF CONFIGURATION ---

async function processCSVAndStoreInDB() {
    console.log('Starting processCSVAndStoreInDB...');
    const client = new MongoClient(MONGODB_URI);
    let browser;
    let page;

    try {
        console.log(`Attempting to connect to MongoDB at ${MONGODB_URI}...`);
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        const database = client.db(DATABASE_NAME);
        const collection = database.collection(COLLECTION_NAME);
        console.log(`Using database: ${DATABASE_NAME}, collection: ${COLLECTION_NAME}`);

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

        const results = [];
        const stream = fs.createReadStream(CSV_FILE_PATH)
            .on('error', (err) => {
                console.error('Error reading CSV file stream:', err);
                if (browser) {
                    browser.close();
                }
                client.close();
                process.exit(1);
            })
            .pipe(csv())
            .on('data', (data) => {
                results.push(data);
            })
            .on('end', async () => {
                console.log(`Finished reading CSV. Found ${results.length} rows.`);
                if (results.length === 0) {
                    console.warn('CSV file might be empty or not parsed correctly.');
                    if (browser) {
                        await browser.close();
                    }
                    await client.close();
                    console.log('Exiting due to no data in CSV.');
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
                    // Log current processing index using 'i'
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
                    const classicUrl = await getRedirectedUrl(salesNavigatorUrl, page, LI_AT_COOKIE_VALUE);
                    let jobData = { description: null, technicalSkills: [] };
                    let generatedEmails = [];

                    if (classicUrl) {
                        console.log(`Successfully obtained classic URL: ${classicUrl}`);
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
                        for (let i = 0; i < core_emails.length; i++) {
                            console.log(`  Generating email ${i + 1}/${core_emails.length}...`);
                            const emailContent = await generateSingleEmail(prospectDataForEmail, core_emails[i], personalization_prompts[i]);
                            generatedEmails.push({
                                sequence: i + 1,
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
                    } else {
                        console.warn(`Could not retrieve classic URL for: ${salesNavigatorUrl}`);
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
                            error: 'Failed to retrieve classic URL',
                            processedAt: new Date()
                        };
                        try {
                            await collection.insertOne(errorData);
                             console.log(`Inserted error record for: ${firstName} ${lastName}`);
                        } catch (dbError) {
                            console.error(`Error inserting error data for ${firstName} ${lastName} into MongoDB: `, dbError);
                        }
                    }
                    console.log('Waiting for 1000ms before next row...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                console.log('Processing complete. Closing browser and MongoDB connection.');
                if (page) {
                    console.log('Closing Puppeteer page...');
                    await page.close();
                }
                if (browser) {
                    await browser.close();
                }
                await client.close();
                console.log('Done.');
            });

    } catch (error) {
        console.error('An critical error occurred in processCSVAndStoreInDB:', error);
        if (browser) {
            console.log('Closing browser due to error...');
            await browser.close();
        }
        console.log('Closing MongoDB connection due to error...');
        await client.close();
        process.exit(1);
    }
}

module.exports = { 
    processCSVAndStoreInDB, 
    LI_AT_COOKIE_VALUE, 
    MONGODB_URI, 
    DATABASE_NAME, 
    COLLECTION_NAME, 
    CSV_FILE_PATH 
}; 