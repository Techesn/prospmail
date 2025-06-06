require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');

const CSV_FILE_PATH = 'processed/data2.csv';

// Mots-clés tech/data pour la classification
const TECH_DATA_KEYWORDS = [
    // Data & Analytics
    'data', 'données', 'analytics', 'analyse', 'statistique', 'business intelligence', 'bi', 'tableau', 'power bi',
    'data science', 'data scientist', 'data engineer', 'data analyst', 'big data', 'machine learning', 'ml', 'ai',
    'intelligence artificielle', 'algorithme', 'modèle', 'prédictif', 'apprentissage automatique',
    
    // Bases de données
    'sql', 'postgresql', 'mysql', 'mongodb', 'base de données', 'database', 'datawarehouse', 'datalake',
    'etl', 'pipeline', 'spark', 'hadoop', 'cassandra', 'redis', 'elasticsearch',
    
    // Programmation
    'python', 'r', 'scala', 'java', 'javascript', 'développement', 'développeur', 'programmation', 'code',
    'github', 'git', 'api', 'rest', 'microservices', 'docker', 'kubernetes', 'cloud', 'aws', 'azure', 'gcp',
    
    // Technologies & Outils
    'kafka', 'airflow', 'jenkins', 'terraform', 'ansible', 'linux', 'unix', 'bash', 'devops',
    'cybersécurité', 'sécurité informatique', 'réseau', 'infrastructure', 'système', 'serveur',
    
    // Tech Business
    'digital', 'numérique', 'transformation digitale', 'innovation', 'startup', 'fintech', 'edtech',
    'saas', 'paas', 'iaas', 'cto', 'cdo', 'chief data officer', 'chief technology officer',
    
    // Métiers tech spécifiques
    'product owner', 'scrum master', 'agile', 'sprint', 'jira', 'confluence', 'product manager tech',
    'architect', 'software engineer', 'full stack', 'frontend', 'backend', 'mobile app', 'web',
    
    // IA & ML spécifique
    'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'pandas', 'numpy', 'jupyter', 'notebook',
    'deep learning', 'neural network', 'nlp', 'computer vision', 'reinforcement learning'
];

// Mots-clés non-tech (pour identification des faux positifs)
const NON_TECH_KEYWORDS = [
    'vente', 'commercial', 'marketing traditionnel', 'comptabilité', 'finance traditionnelle', 'rh', 'ressources humaines',
    'juridique', 'legal', 'communication', 'relations publiques', 'event', 'événementiel',
    'immobilier', 'construction', 'btp', 'agriculture', 'agroalimentaire', 'restauration',
    'hôtellerie', 'tourisme', 'transport routier', 'logistique traditionnelle', 'retail traditionnel'
];

function analyzeJobDescription(description, name, jobTitle) {
    if (!description || description.trim() === '') {
        return {
            isTechData: false,
            confidence: 0,
            reason: 'Description vide',
            keywords: []
        };
    }
    
    const descLower = description.toLowerCase();
    const foundTechKeywords = [];
    const foundNonTechKeywords = [];
    
    // Rechercher les mots-clés tech/data
    TECH_DATA_KEYWORDS.forEach(keyword => {
        if (descLower.includes(keyword.toLowerCase())) {
            foundTechKeywords.push(keyword);
        }
    });
    
    // Rechercher les mots-clés non-tech
    NON_TECH_KEYWORDS.forEach(keyword => {
        if (descLower.includes(keyword.toLowerCase())) {
            foundNonTechKeywords.push(keyword);
        }
    });
    
    // Analyser le titre du poste aussi
    const titleLower = jobTitle ? jobTitle.toLowerCase() : '';
    const titleTechKeywords = [];
    TECH_DATA_KEYWORDS.forEach(keyword => {
        if (titleLower.includes(keyword.toLowerCase())) {
            titleTechKeywords.push(keyword);
        }
    });
    
    // Calculer le score de confiance
    const techScore = foundTechKeywords.length + titleTechKeywords.length * 2; // Titre compte double
    const nonTechScore = foundNonTechKeywords.length;
    
    // Déterminer si c'est tech/data
    let isTechData = false;
    let confidence = 0;
    let reason = '';
    
    if (techScore >= 3) {
        isTechData = true;
        confidence = Math.min(90, 50 + techScore * 10);
        reason = `${techScore} mots-clés tech/data trouvés`;
    } else if (techScore >= 1 && nonTechScore === 0) {
        isTechData = true;
        confidence = 30 + techScore * 15;
        reason = `${techScore} mots-clés tech/data, aucun non-tech`;
    } else if (nonTechScore > techScore) {
        isTechData = false;
        confidence = Math.min(80, 40 + nonTechScore * 10);
        reason = `Plus de mots-clés non-tech (${nonTechScore}) que tech (${techScore})`;
    } else if (techScore === 0) {
        isTechData = false;
        confidence = 70;
        reason = 'Aucun mot-clé tech/data trouvé';
    } else {
        isTechData = false;
        confidence = 40;
        reason = `Peu de mots-clés tech (${techScore}), ambigu`;
    }
    
    return {
        isTechData,
        confidence,
        reason,
        keywords: foundTechKeywords,
        nonTechKeywords: foundNonTechKeywords,
        titleKeywords: titleTechKeywords,
        techScore,
        nonTechScore
    };
}

async function analyzeJobDescriptions() {
    console.log('🔍 Analyzing job descriptions in data2.csv...');
    console.log(`📁 File: ${CSV_FILE_PATH}`);
    
    let totalEntries = 0;
    let techDataJobs = 0;
    let nonTechJobs = 0;
    let ambiguousJobs = 0;
    let emptyDescriptions = 0;
    
    const batchSize = 50;
    let currentBatch = [];
    let batchNumber = 1;
    
    const nonTechExamples = [];
    const ambiguousExamples = [];
    
    console.log('\n📊 Processing job descriptions by batches of 50...\n');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                totalEntries++;
                
                const firstName = row['FirstName'] || '';
                const lastName = row['LastName'] || '';
                const fullName = `${firstName} ${lastName}`.trim();
                const jobTitle = row['JobTitle'] || '';
                const jobDescription = row['LatestJobDescription'] || '';
                
                const analysis = analyzeJobDescription(jobDescription, fullName, jobTitle);
                
                const entry = {
                    name: fullName,
                    jobTitle,
                    description: jobDescription.substring(0, 200) + (jobDescription.length > 200 ? '...' : ''),
                    analysis
                };
                
                currentBatch.push(entry);
                
                // Compter les catégories
                if (!jobDescription || jobDescription.trim() === '') {
                    emptyDescriptions++;
                } else if (analysis.isTechData) {
                    techDataJobs++;
                } else if (analysis.confidence >= 60) {
                    nonTechJobs++;
                    if (nonTechExamples.length < 10) {
                        nonTechExamples.push(entry);
                    }
                } else {
                    ambiguousJobs++;
                    if (ambiguousExamples.length < 10) {
                        ambiguousExamples.push(entry);
                    }
                }
                
                // Traiter le batch quand il est plein
                if (currentBatch.length === batchSize) {
                    processBatch(currentBatch, batchNumber);
                    currentBatch = [];
                    batchNumber++;
                }
            })
            .on('end', () => {
                // Traiter le dernier batch s'il n'est pas vide
                if (currentBatch.length > 0) {
                    processBatch(currentBatch, batchNumber);
                }
                
                // Afficher le rapport final
                console.log('\n' + '='.repeat(80));
                console.log('🎯 FINAL ANALYSIS REPORT');
                console.log('='.repeat(80));
                
                console.log(`\n📊 Overall Statistics:`);
                console.log(`   Total entries analyzed: ${totalEntries}`);
                console.log(`   ✅ Tech/Data jobs: ${techDataJobs} (${((techDataJobs/totalEntries)*100).toFixed(1)}%)`);
                console.log(`   ❌ Non-Tech jobs: ${nonTechJobs} (${((nonTechJobs/totalEntries)*100).toFixed(1)}%)`);
                console.log(`   ❓ Ambiguous jobs: ${ambiguousJobs} (${((ambiguousJobs/totalEntries)*100).toFixed(1)}%)`);
                console.log(`   📝 Empty descriptions: ${emptyDescriptions} (${((emptyDescriptions/totalEntries)*100).toFixed(1)}%)`);
                
                // Exemples de jobs non-tech
                if (nonTechExamples.length > 0) {
                    console.log(`\n❌ Examples of NON-TECH jobs detected:`);
                    nonTechExamples.slice(0, 5).forEach((example, index) => {
                        console.log(`\n   ${index + 1}. ${example.name} - ${example.jobTitle}`);
                        console.log(`      Reason: ${example.analysis.reason}`);
                        console.log(`      Confidence: ${example.analysis.confidence}%`);
                        if (example.analysis.nonTechKeywords.length > 0) {
                            console.log(`      Non-tech keywords: ${example.analysis.nonTechKeywords.join(', ')}`);
                        }
                        console.log(`      Description: "${example.description}"`);
                    });
                }
                
                // Exemples de jobs ambigus
                if (ambiguousExamples.length > 0) {
                    console.log(`\n❓ Examples of AMBIGUOUS jobs:`);
                    ambiguousExamples.slice(0, 5).forEach((example, index) => {
                        console.log(`\n   ${index + 1}. ${example.name} - ${example.jobTitle}`);
                        console.log(`      Reason: ${example.analysis.reason}`);
                        console.log(`      Confidence: ${example.analysis.confidence}%`);
                        if (example.analysis.keywords.length > 0) {
                            console.log(`      Tech keywords found: ${example.analysis.keywords.join(', ')}`);
                        }
                        console.log(`      Description: "${example.description}"`);
                    });
                }
                
                console.log(`\n💡 RECOMMENDATIONS:`);
                const nonTechPercentage = (nonTechJobs/totalEntries)*100;
                if (nonTechPercentage > 10) {
                    console.log(`   🚨 High percentage of non-tech jobs (${nonTechPercentage.toFixed(1)}%) - review targeting criteria`);
                }
                if (emptyDescriptions > totalEntries * 0.1) {
                    console.log(`   📝 Many empty descriptions (${emptyDescriptions}) - improve job description extraction`);
                }
                if (ambiguousJobs > totalEntries * 0.2) {
                    console.log(`   ❓ Many ambiguous jobs (${ambiguousJobs}) - consider refining classification keywords`);
                }
                
                console.log('\n✅ Job description analysis completed!');
                resolve();
            })
            .on('error', (error) => {
                console.error('❌ Error reading CSV file:', error);
                reject(error);
            });
    });
}

function processBatch(batch, batchNumber) {
    console.log(`📦 BATCH ${batchNumber} (${batch.length} entries)`);
    
    let batchTechData = 0;
    let batchNonTech = 0;
    let batchAmbiguous = 0;
    let batchEmpty = 0;
    
    const notableIssues = [];
    
    batch.forEach(entry => {
        if (!entry.analysis) return;
        
        if (entry.description === '' || entry.description === '...') {
            batchEmpty++;
        } else if (entry.analysis.isTechData) {
            batchTechData++;
        } else if (entry.analysis.confidence >= 60) {
            batchNonTech++;
            notableIssues.push(`❌ ${entry.name} - ${entry.jobTitle} (${entry.analysis.reason})`);
        } else {
            batchAmbiguous++;
            notableIssues.push(`❓ ${entry.name} - ${entry.jobTitle} (${entry.analysis.reason})`);
        }
    });
    
    console.log(`   ✅ Tech/Data: ${batchTechData} | ❌ Non-Tech: ${batchNonTech} | ❓ Ambiguous: ${batchAmbiguous} | 📝 Empty: ${batchEmpty}`);
    
    if (notableIssues.length > 0) {
        console.log(`   🔍 Notable issues in this batch:`);
        notableIssues.slice(0, 3).forEach(issue => {
            console.log(`      ${issue}`);
        });
        if (notableIssues.length > 3) {
            console.log(`      ... and ${notableIssues.length - 3} more issues`);
        }
    }
    
    console.log('');
}

// Lancer l'analyse
analyzeJobDescriptions().catch(error => {
    console.error('Critical error during analysis:', error);
    process.exit(1);
}); 