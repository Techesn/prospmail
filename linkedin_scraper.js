const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');

// --- START OF CONFIGURATION ---
// TODO: Replace with your actual li_at cookie value
const LI_AT_COOKIE_VALUE = 'AQEDASiDinkE2j0aAAABlvIiXwUAAAGXFi7jBU4AJRnELqmlJVp4RJbioytFmQEvLfB4-oT89nj7lqUtRBjkk2JGdtlAuLqmMLpcSCaoFed4IbNX4gLaq6bb5SYsS8B02LiRVuZ2KvMXXvcMacuEM2OE';
// TODO: Replace with your MongoDB connection string
const MONGODB_URI = 'mongodb://localhost:27017';
const DATABASE_NAME = 'linkedin_data';
const COLLECTION_NAME = 'profiles';
const CSV_FILE_PATH = 'exportLGM.csv';

// --- END OF CONFIGURATION ---

async function getRedirectedUrl(originalUrl, page) {
    if (!originalUrl || !originalUrl.startsWith('http')) {
        console.warn(`Skipping invalid URL: ${originalUrl}`);
        return null;
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
        return finalUrl;
    } catch (error) {
        console.error(`Error navigating to ${originalUrl}: ${error.message}`);
        return null;
    }
}

async function extractLatestJobDescription(page) {
    console.log('Attempting to extract latest job description...');
    try {
        // Scroll down 1/4th of the page height
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight / 4);
        });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for scroll to take effect

        // Selector for the experience item blocks
        const experienceItemSelector = 'div[data-view-name="profile-component-entity"]';
        
        // Wait for at least one experience item to be present
        try {
            await page.waitForSelector(experienceItemSelector, { timeout: 10000 });
        } catch (e) {
            console.warn('No experience items found with selector:', experienceItemSelector);
            return null;
        }

        // Get the first experience item (assuming it's the latest)
        const firstExperienceItem = await page.$(experienceItemSelector);

        if (!firstExperienceItem) {
            console.warn('Could not find the first experience item.');
            return null;
        }

        // Scroll the specific item into view
        await firstExperienceItem.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll

        // Try to click the "…voir plus" or "…see more" button within this item
        const seeMoreButtonSelector = 'button.inline-show-more-text__button';
        const seeMoreButton = await firstExperienceItem.$(seeMoreButtonSelector);

        if (seeMoreButton) {
            try {
                console.log('Found "see more" button for job description, attempting to click...');
                await seeMoreButton.click();
                // Wait for content to expand after click
                await new Promise(resolve => setTimeout(resolve, 1000)); 
            } catch (e) {
                console.warn('Could not click "see more" button (it might have been hidden or already expanded):', e.message);
            }
        } else {
            console.log('No "see more" button found for the latest job description.');
        }

        // Extract the description text
        // Prefer the visually-hidden span as it often contains the full text after expansion or for non-truncated text.
        let descriptionText = null;
        const descriptionContainerSelector = '.inline-show-more-text'; // Common parent for description spans
        const descriptionContainer = await firstExperienceItem.$(descriptionContainerSelector);

        if (descriptionContainer) {
            const visuallyHiddenSpan = await descriptionContainer.$('span.visually-hidden');
            if (visuallyHiddenSpan) {
                descriptionText = await visuallyHiddenSpan.evaluate(el => el.textContent.trim());
            }

            // Fallback to aria-hidden if visually-hidden is not found or empty
            if (!descriptionText) {
                const ariaHiddenSpan = await descriptionContainer.$('span[aria-hidden="true"]');
                if (ariaHiddenSpan) {
                    descriptionText = await ariaHiddenSpan.evaluate(el => el.textContent.trim());
                }
            }
        } else {
            console.warn('Description container (.inline-show-more-text) not found in the experience item.');
        }
        
        // Clean up common "see more" artifacts if they are part of the text
        if (descriptionText) {
            descriptionText = descriptionText.replace(/…voir plus$/, '').replace(/…see more$/, '').trim();
        }

        if (descriptionText && descriptionText.length > 0) {
            console.log('Extracted job description (first 100 chars):', descriptionText.substring(0, 100) + '...');
            return descriptionText;
        } else {
            console.warn('Job description text not found or was empty within the experience item.');
            return null;
        }

    } catch (error) {
        console.error('Error extracting job description:', error);
        return null;
    }
}

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

        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({ headless: false }); // Set to false to see the browser
        console.log('Puppeteer launched.');
        page = await browser.newPage();
        console.log('Puppeteer page created and will be reused.');

        const results = [];
        const stream = fs.createReadStream(CSV_FILE_PATH)
            .on('error', (err) => {
                console.error('Error reading CSV file stream:', err);
                // Ensure cleanup if CSV reading fails critically
                if (browser) {
                    browser.close();
                }
                client.close();
                process.exit(1); // Exit if CSV can't be read
            })
            .pipe(csv())
            .on('data', (data) => {
                // console.log('CSV row read:', data); // Uncomment for very verbose logging
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
                    return; // Important to stop further processing
                }

                for (const [index, row] of results.entries()) {
                    console.log(`Processing row ${index + 1}/${results.length}...`);
                    const salesNavigatorUrl = row['linkedinUrl'];
                    const firstName = row['firstname'];
                    const lastName = row['lastname'];
                    const jobTitle = row['jobTitle'];
                    const companyName = row['companyName'];

                    if (!salesNavigatorUrl) {
                        console.warn('linkedinUrl is missing for a row:', row);
                        // Also add null for job description if URL is missing
                        const errorData = {
                            firstName: row['firstname'],
                            lastName: row['lastname'],
                            jobTitle: row['jobTitle'],
                            companyName: row['companyName'],
                            salesNavigatorUrl: null,
                            linkedinUrl: null,
                            latestJobDescription: null, // Add field here
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

                    const classicUrl = await getRedirectedUrl(salesNavigatorUrl, page);
                    let jobDescription = null; // Initialize jobDescription

                    if (classicUrl) {
                        console.log(`Successfully obtained classic URL: ${classicUrl}`);
                        console.log('Waiting 2000ms before attempting to extract job description...');
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay before extraction

                        jobDescription = await extractLatestJobDescription(page);

                        const profileData = {
                            firstName,
                            lastName,
                            jobTitle, // This is from CSV
                            companyName, // This is from CSV
                            salesNavigatorUrl,
                            linkedinUrl: classicUrl,
                            latestJobDescription: jobDescription, // Added new field
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
                            salesNavigatorUrl,
                            linkedinUrl: null, // classicUrl is null here
                            latestJobDescription: null, // Could not attempt extraction
                            error: 'Failed to retrieve classic URL',
                            processedAt: new Date()
                        };
                        // Optionally, insert errored records into a separate collection or log them differently
                        try {
                            await collection.insertOne(errorData);
                             console.log(`Inserted error record for: ${firstName} ${lastName}`);
                        } catch (dbError) {
                            console.error(`Error inserting error data for ${firstName} ${lastName} into MongoDB: `, dbError);
                        }
                    }
                    // Add a delay to avoid overwhelming LinkedIn
                    console.log('Waiting for 1000ms before next row...'); // Respecting user's last change
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

if (LI_AT_COOKIE_VALUE === 'YOUR_LI_AT_COOKIE_HERE' || MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
    console.error("---------------------------------------------------------------------");
    console.error("IMPORTANT: Please update LI_AT_COOKIE_VALUE and MONGODB_URI in the script.");
    console.error("---------------------------------------------------------------------");
} else {
    processCSVAndStoreInDB();
} 