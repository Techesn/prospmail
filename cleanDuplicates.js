require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = 'linkedin_data';
const COLLECTION_NAME = 'data2';

// Entreprises à supprimer
const COMPANIES_TO_REMOVE = [
    'Décathlon',
    'decathlon',
    'DÉCATHLON',
    'DECATHLON',
    'Back Market',
    'BackMarket',
    'Backmarket',
    'backmarket',
    'BACK MARKET',
    'BACKMARKET',
    'Scaleway',
    'scaleway',
    'SCALEWAY'
];

async function cleanDuplicates() {
    console.log('🧹 Starting duplicate cleanup for collection:', COLLECTION_NAME);
    
    let client;
    
    try {
        // Connexion à MongoDB
        client = new MongoClient(MONGODB_URI);
        console.log('Connecting to MongoDB...');
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const database = client.db(DATABASE_NAME);
        const collection = database.collection(COLLECTION_NAME);
        
        // Compter le nombre total d'entrées avant nettoyage
        const totalBefore = await collection.countDocuments();
        console.log(`📊 Total entries before cleanup: ${totalBefore}`);
        
        if (totalBefore === 0) {
            console.log('⚠️ Collection is empty. Nothing to clean.');
            return;
        }
        
        // === ÉTAPE 1: NETTOYAGE DES DOUBLONS ===
        console.log('\n🔍 STEP 1: Finding duplicates based on firstName + lastName...');
        
        // Aggregation pipeline pour trouver les doublons
        const duplicates = await collection.aggregate([
            {
                $group: {
                    _id: {
                        firstName: "$firstName",
                        lastName: "$lastName"
                    },
                    count: { $sum: 1 },
                    docs: { $push: "$$ROOT" }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]).toArray();
        
        console.log(`🔍 Found ${duplicates.length} sets of duplicates`);
        
        let duplicatesRemoved = 0;
        
        if (duplicates.length > 0) {
            let totalDuplicatesToRemove = 0;
            
            // Calculer le nombre total de doublons à supprimer
            duplicates.forEach(duplicate => {
                totalDuplicatesToRemove += (duplicate.count - 1); // Garde 1, supprime les autres
            });
            
            console.log(`📋 Details of duplicates found:`);
            duplicates.forEach((duplicate, index) => {
                const name = `${duplicate._id.firstName} ${duplicate._id.lastName}`;
                console.log(`   ${index + 1}. ${name}: ${duplicate.count} entries`);
            });
            
            console.log(`🗑️ Will remove ${totalDuplicatesToRemove} duplicate entries`);
            console.log('📅 Strategy: Keep the most recent entry (latest processedAt) for each name');
            
            // Pour chaque groupe de doublons
            for (let i = 0; i < duplicates.length; i++) {
                const duplicate = duplicates[i];
                const name = `${duplicate._id.firstName} ${duplicate._id.lastName}`;
                
                console.log(`\n📝 Processing ${i + 1}/${duplicates.length}: ${name} (${duplicate.count} entries)`);
                
                // Trier les documents par date de traitement (le plus récent en premier)
                const sortedDocs = duplicate.docs.sort((a, b) => {
                    const dateA = new Date(a.processedAt || 0);
                    const dateB = new Date(b.processedAt || 0);
                    return dateB - dateA; // Décroissant (plus récent en premier)
                });
                
                // Garder le premier (plus récent), supprimer les autres
                const toKeep = sortedDocs[0];
                const toRemove = sortedDocs.slice(1);
                
                console.log(`   ✅ Keeping: ID ${toKeep._id} (processed: ${toKeep.processedAt})`);
                
                // Supprimer les doublons
                for (const doc of toRemove) {
                    try {
                        await collection.deleteOne({ _id: doc._id });
                        duplicatesRemoved++;
                        console.log(`   🗑️ Removed: ID ${doc._id} (processed: ${doc.processedAt})`);
                    } catch (error) {
                        console.error(`   ❌ Error removing ID ${doc._id}:`, error.message);
                    }
                }
            }
        } else {
            console.log('✅ No duplicates found.');
        }
        
        // === ÉTAPE 2: SUPPRESSION DES ENTREPRISES SPÉCIFIQUES ===
        console.log('\n🏢 STEP 2: Finding prospects from specific companies to remove...');
        console.log('🎯 Target companies: Décathlon, Back Market, Scaleway');
        
        // Créer une regex pour matcher toutes les variantes
        const companyRegex = new RegExp(COMPANIES_TO_REMOVE.join('|'), 'i');
        
        // Trouver tous les prospects de ces entreprises
        const prospectsToRemove = await collection.find({
            companyName: { $regex: companyRegex }
        }).toArray();
        
        console.log(`🔍 Found ${prospectsToRemove.length} prospects from target companies`);
        
        let companyProspectsRemoved = 0;
        
        if (prospectsToRemove.length > 0) {
            console.log(`📋 Details of prospects to remove:`);
            
            // Grouper par entreprise pour l'affichage
            const groupedByCompany = {};
            prospectsToRemove.forEach(prospect => {
                const company = prospect.companyName || 'Unknown';
                if (!groupedByCompany[company]) {
                    groupedByCompany[company] = [];
                }
                groupedByCompany[company].push(prospect);
            });
            
            Object.keys(groupedByCompany).forEach(company => {
                console.log(`   📦 ${company}: ${groupedByCompany[company].length} prospects`);
            });
            
            // Demander confirmation
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            
            const confirmation = await new Promise(resolve => {
                rl.question('\n❓ Do you want to proceed with both duplicate cleanup AND company removal? (yes/no): ', answer => {
                    rl.close();
                    resolve(answer.toLowerCase());
                });
            });
            
            if (confirmation !== 'yes' && confirmation !== 'y') {
                console.log('❌ Cleanup cancelled by user.');
                return;
            }
            
            console.log('\n🚀 Starting company prospects removal...');
            
            // Supprimer tous les prospects des entreprises ciblées
            for (let i = 0; i < prospectsToRemove.length; i++) {
                const prospect = prospectsToRemove[i];
                try {
                    await collection.deleteOne({ _id: prospect._id });
                    companyProspectsRemoved++;
                    console.log(`   🗑️ Removed: ${prospect.firstName} ${prospect.lastName} from ${prospect.companyName} (ID: ${prospect._id})`);
                } catch (error) {
                    console.error(`   ❌ Error removing prospect ${prospect.firstName} ${prospect.lastName}:`, error.message);
                }
            }
        } else {
            console.log('✅ No prospects found from target companies.');
            
            // Si pas de prospects d'entreprises mais des doublons, demander confirmation quand même
            if (duplicatesRemoved > 0) {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
                
                const confirmation = await new Promise(resolve => {
                    rl.question('\n❓ Do you want to proceed with duplicate cleanup? (yes/no): ', answer => {
                        rl.close();
                        resolve(answer.toLowerCase());
                    });
                });
                
                if (confirmation !== 'yes' && confirmation !== 'y') {
                    console.log('❌ Cleanup cancelled by user.');
                    return;
                }
            }
        }
        
        // Compter les entrées après nettoyage
        const totalAfter = await collection.countDocuments();
        const totalRemoved = duplicatesRemoved + companyProspectsRemoved;
        
        console.log('\n🎉 Cleanup completed!');
        console.log(`📊 Final Results:`);
        console.log(`   Before cleanup: ${totalBefore} entries`);
        console.log(`   After cleanup: ${totalAfter} entries`);
        console.log(`   ├── Duplicates removed: ${duplicatesRemoved}`);
        console.log(`   ├── Company prospects removed: ${companyProspectsRemoved}`);
        console.log(`   └── Total removed: ${totalRemoved}`);
        
        if (totalAfter + totalRemoved === totalBefore) {
            console.log('✅ All operations completed successfully!');
        } else {
            console.log('⚠️ Numbers don\'t match. Please verify manually.');
        }
        
    } catch (error) {
        console.error('❌ Critical error during cleanup:', error);
    } finally {
        if (client) {
            console.log('Closing MongoDB connection...');
            await client.close();
            console.log('✅ MongoDB connection closed');
        }
    }
}

// Vérification des variables d'environnement
if (!MONGODB_URI || MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
    console.error('❌ MONGODB_URI not set in .env file');
    process.exit(1);
}

// Lancer le nettoyage
cleanDuplicates().catch(error => {
    console.error('Critical error:', error);
    process.exit(1);
}); 