require('dotenv').config(); // Load environment variables
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const readline = require('readline'); // Added readline
// const { MONGODB_URI, DATABASE_NAME, COLLECTION_NAME } = require('./processCSVAndStoreInDB.js'); // No longer importing these
const { MONGODB_URI } = require('./processCSVAndStoreInDB.js'); // Only MONGODB_URI needed if it's guaranteed to be there
const { core_emails } = require('./emailGenerator.js'); // To determine max number of emails

const OUTPUT_CSV_FILE_PATH_BASE = 'exported_profiles'; // Base for output file name

// Helper function to get user input
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Function to escape CSV data: handles commas, quotes, and newlines
function escapeCsvData(data) {
    if (data === null || typeof data === 'undefined') {
        return '';
    }
    const stringData = String(data);
    if (stringData.includes(',') || stringData.includes('"') || stringData.includes('\n')) {
        return `"${stringData.replace(/"/g, '""')}"`;
    }
    return stringData;
}

async function exportDbToCsv() {
    console.log('Starting database export to CSV...');

    const dbNameFromUser = await askQuestion('Enter the DATABASE name to export from: ');
    if (!dbNameFromUser || dbNameFromUser.trim() === '') {
        console.error('Database name cannot be empty. Exiting.');
        process.exit(1);
    }

    const collectionNameFromUser = await askQuestion(`Enter the COLLECTION name from database '${dbNameFromUser}' to export: `);
    if (!collectionNameFromUser || collectionNameFromUser.trim() === '') {
        console.error('Collection name cannot be empty. Exiting.');
        process.exit(1);
    }

    const outputCsvFilePath = `${OUTPUT_CSV_FILE_PATH_BASE}_${dbNameFromUser}_${collectionNameFromUser}.csv`;

    let client; // Declare client outside try to be accessible in finally

    try {
        // MONGODB_URI should be loaded from .env via processCSVAndStoreInDB.js or directly here if preferred
        if (!MONGODB_URI) {
            console.error('MONGODB_URI is not defined. Please ensure it is set in your .env file and loaded correctly.');
            process.exit(1);
        }
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Successfully connected to MongoDB.');

        const database = client.db(dbNameFromUser);
        const collection = database.collection(collectionNameFromUser);
        console.log(`Fetching data from ${dbNameFromUser}.${collectionNameFromUser}...`);

        const profiles = await collection.find({}).toArray();
        console.log(`Found ${profiles.length} profiles to export.`);

        if (profiles.length === 0) {
            console.log('No profiles found in the specified database/collection. Exiting.');
            // No need to await client.close() here, finally block will handle it.
            return;
        }

        const maxEmails = core_emails.length;
        const headers = [
            'FirstName', 'LastName', 'JobTitle', 'LinkedInURL',
            'LatestJobDescription', 'TechnicalSkills'
        ];
        for (let i = 1; i <= maxEmails; i++) {
            headers.push(`Email ${i}`);
        }

        let csvContent = headers.join(',') + '\n';
        for (const profile of profiles) {
            const row = [
                escapeCsvData(profile.firstName),
                escapeCsvData(profile.lastName),
                escapeCsvData(profile.jobTitle),
                escapeCsvData(profile.linkedinUrl),
                escapeCsvData(profile.latestJobDescription),
                escapeCsvData(profile.technicalSkills ? profile.technicalSkills.join(', ') : '')
            ];
            for (let i = 0; i < maxEmails; i++) {
                const emailEntry = profile.generatedEmails && profile.generatedEmails[i] ? profile.generatedEmails[i] : null;
                row.push(escapeCsvData(emailEntry ? emailEntry.contenu : ''));
            }
            csvContent += row.join(',') + '\n';
        }

        fs.writeFileSync(outputCsvFilePath, csvContent);
        console.log(`Successfully exported ${profiles.length} profiles to ${outputCsvFilePath}`);

    } catch (error) {
        console.error('Error during CSV export:', error);
    } finally {
        if (client && client.topology && client.topology.isConnected()) {
            await client.close();
            console.log('MongoDB connection closed.');
        }
    }
}

exportDbToCsv().catch(console.error);

module.exports = { exportDbToCsv }; 