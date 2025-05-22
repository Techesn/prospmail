const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const { MONGODB_URI, DATABASE_NAME, COLLECTION_NAME } = require('./processCSVAndStoreInDB.js'); // Assuming these are exported
const { core_emails } = require('./emailGenerator.js'); // To determine max number of emails

const OUTPUT_CSV_FILE_PATH = 'exported_profiles_with_emails.csv';

// Function to escape CSV data: handles commas, quotes, and newlines
function escapeCsvData(data) {
    if (data === null || typeof data === 'undefined') {
        return '';
    }
    const stringData = String(data);
    // If data contains a comma, a quote, or a newline, wrap it in double quotes
    // and escape any existing double quotes by doubling them
    if (stringData.includes(',') || stringData.includes('"') || stringData.includes('\n')) {
        return `"${stringData.replace(/"/g, '""')}"`;
    }
    return stringData;
}

async function exportDbToCsv() {
    console.log('Starting database export to CSV...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Successfully connected to MongoDB.');
        const database = client.db(DATABASE_NAME);
        const collection = database.collection(COLLECTION_NAME);
        console.log(`Fetching data from ${DATABASE_NAME}.${COLLECTION_NAME}...`);

        const profiles = await collection.find({}).toArray();
        console.log(`Found ${profiles.length} profiles to export.`);

        if (profiles.length === 0) {
            console.log('No profiles found in the database. Exiting.');
            return;
        }

        const maxEmails = core_emails.length; // Determine max number of emails from emailGenerator.js

        // Define CSV Headers
        const headers = [
            'FirstName', 'LastName', 'JobTitle', 'LinkedInURL',
            'LatestJobDescription', 'TechnicalSkills'
        ];

        for (let i = 1; i <= maxEmails; i++) {
            headers.push(`Email ${i}`);
        }

        // Start CSV content with headers
        let csvContent = headers.join(',') + '\n';

        // Process each profile
        for (const profile of profiles) {
            const row = [
                escapeCsvData(profile.firstName),
                escapeCsvData(profile.lastName),
                escapeCsvData(profile.jobTitle),
                escapeCsvData(profile.linkedinUrl), // Data from DB
                escapeCsvData(profile.latestJobDescription),
                escapeCsvData(profile.technicalSkills ? profile.technicalSkills.join(', ') : '')
            ];

            // Add email contents
            for (let i = 0; i < maxEmails; i++) {
                const emailEntry = profile.generatedEmails && profile.generatedEmails[i] ? profile.generatedEmails[i] : null;
                row.push(escapeCsvData(emailEntry ? emailEntry.contenu : '')); // Only content
            }
            csvContent += row.join(',') + '\n';
        }

        fs.writeFileSync(OUTPUT_CSV_FILE_PATH, csvContent);
        console.log(`Successfully exported ${profiles.length} profiles to ${OUTPUT_CSV_FILE_PATH}`);

    } catch (error) {
        console.error('Error during CSV export:', error);
    } finally {
        await client.close();
        console.log('MongoDB connection closed.');
    }
}

exportDbToCsv().catch(console.error);

module.exports = { exportDbToCsv }; 