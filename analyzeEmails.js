require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');

const CSV_FILE_PATH = 'processed/data2.csv';

// Mots-clés pour détecter les erreurs Groq
const GROQ_ERROR_KEYWORDS = [
    'Erreur de génération',
    'Groq',
    'erreur de génération',
    'GROQ',
    'Error generating',
    'API Error',
    'non disponible',
    'indisponible',
    'génération échouée',
    'failed to generate',
    'timeout',
    'rate limit'
];

// Mots-clés pour détecter des emails génériques/mal générés
const GENERIC_EMAIL_KEYWORDS = [
    'Voici l\'email',
    'Voici le mail',
    'Email généré',
    'Mail généré',
    'Lorem ipsum',
    'Example',
    'Test',
    'TODO',
    'PLACEHOLDER',
    '[Nom]',
    '[Prénom]',
    '[Entreprise]',
    'Cher/Chère',
    'Bonjour [',
    'Hello [',
    'undefined',
    'null',
    'NaN'
];

// Mots-clés pour détecter des erreurs dans le contenu
const CONTENT_ERROR_KEYWORDS = [
    'Je ne peux pas',
    'Je ne suis pas capable',
    'Information non disponible',
    'Données insuffisantes',
    'Impossible de générer',
    'Erreur dans',
    'Problème avec',
    'Cannot generate',
    'Unable to create',
    'No data available',
    'Je suis désolé',
    'Malheureusement',
    'Je ne trouve pas',
    'Aucune information'
];

function analyzeEmailContent(emailContent, emailIndex, personName) {
    const issues = [];
    
    if (!emailContent || emailContent.trim() === '') {
        issues.push(`Email ${emailIndex}: Contenu vide`);
        return issues;
    }
    
    const content = emailContent.toLowerCase();
    
    // Vérifier les erreurs Groq
    GROQ_ERROR_KEYWORDS.forEach(keyword => {
        if (content.includes(keyword.toLowerCase())) {
            issues.push(`Email ${emailIndex}: Erreur Groq détectée - "${keyword}"`);
        }
    });
    
    // Vérifier les emails génériques
    GENERIC_EMAIL_KEYWORDS.forEach(keyword => {
        if (content.includes(keyword.toLowerCase())) {
            issues.push(`Email ${emailIndex}: Email générique détecté - "${keyword}"`);
        }
    });
    
    // Vérifier les erreurs de contenu
    CONTENT_ERROR_KEYWORDS.forEach(keyword => {
        if (content.includes(keyword.toLowerCase())) {
            issues.push(`Email ${emailIndex}: Erreur de contenu - "${keyword}"`);
        }
    });
    
    // Vérifier si l'email est trop court (moins de 100 caractères)
    if (emailContent.trim().length < 100) {
        issues.push(`Email ${emailIndex}: Email trop court (${emailContent.trim().length} caractères)`);
    }
    
    // Vérifier si l'email contient des placeholders non remplacés
    const placeholderPattern = /\{|\}|\[|\]|<<|>>|\{\{|\}\}/;
    if (placeholderPattern.test(emailContent)) {
        issues.push(`Email ${emailIndex}: Placeholders non remplacés détectés`);
    }
    
    // Vérifier si l'email ne mentionne pas le nom de la personne
    if (personName && !content.includes(personName.toLowerCase().split(' ')[0])) {
        // Pas critique mais intéressant à noter
        // issues.push(`Email ${emailIndex}: Ne mentionne pas le prénom`);
    }
    
    // Vérifier les incohérences
    if (content.includes('monsieur') && content.includes('madame')) {
        issues.push(`Email ${emailIndex}: Confusion civilité (monsieur ET madame)`);
    }
    
    return issues;
}

function analyzeJobDescription(description) {
    const issues = [];
    
    if (!description || description.trim() === '') {
        issues.push('Description de poste vide');
        return issues;
    }
    
    if (description.toLowerCase().includes('aucune description')) {
        issues.push('Description de poste indisponible');
    }
    
    if (description.trim().length < 30) {
        issues.push(`Description de poste trop courte (${description.trim().length} caractères)`);
    }
    
    GROQ_ERROR_KEYWORDS.forEach(keyword => {
        if (description.toLowerCase().includes(keyword.toLowerCase())) {
            issues.push(`Erreur Groq dans description - "${keyword}"`);
        }
    });
    
    return issues;
}

async function analyzeData() {
    console.log('🔍 Starting analysis of data2.csv...');
    console.log(`📁 File: ${CSV_FILE_PATH}`);
    
    let totalEntries = 0;
    let entriesWithIssues = 0;
    let totalIssues = 0;
    let totalEmails = 0;
    let emailsWithIssues = 0;
    
    const issuesSummary = {
        groqErrors: 0,
        genericEmails: 0,
        contentErrors: 0,
        shortEmails: 0,
        emptyEmails: 0,
        placeholderIssues: 0,
        jobDescriptionIssues: 0,
        civilityConfusion: 0
    };
    
    const detailedIssues = [];
    const companiesWithIssues = new Set();
    const emailLengthStats = [];
    
    console.log('\n📊 Processing entries...');
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                totalEntries++;
                
                const firstName = row['FirstName'] || row['firstName'] || '';
                const lastName = row['LastName'] || row['lastName'] || '';
                const fullName = `${firstName} ${lastName}`.trim();
                const jobDescription = row['LatestJobDescription'] || row['latestJobDescription'] || '';
                
                let entryIssues = [];
                
                // Analyser la description de poste
                const jobIssues = analyzeJobDescription(jobDescription);
                if (jobIssues.length > 0) {
                    entryIssues = entryIssues.concat(jobIssues);
                    issuesSummary.jobDescriptionIssues += jobIssues.length;
                }
                
                // Analyser les emails générés (colonnes "Email 1", "Email 2", etc.)
                for (let emailIndex = 1; emailIndex <= 10; emailIndex++) {
                    const emailColumnName = `Email ${emailIndex}`;
                    const emailContent = row[emailColumnName];
                    
                    if (emailContent && emailContent.trim() !== '') {
                        totalEmails++;
                        emailLengthStats.push(emailContent.trim().length);
                        
                        const emailIssues = analyzeEmailContent(emailContent, emailIndex, fullName);
                        if (emailIssues.length > 0) {
                            emailsWithIssues++;
                            entryIssues = entryIssues.concat(emailIssues);
                            
                            // Compter les types d'issues
                            emailIssues.forEach(issue => {
                                if (issue.includes('Erreur Groq')) issuesSummary.groqErrors++;
                                if (issue.includes('générique')) issuesSummary.genericEmails++;
                                if (issue.includes('Erreur de contenu')) issuesSummary.contentErrors++;
                                if (issue.includes('trop court')) issuesSummary.shortEmails++;
                                if (issue.includes('vide')) issuesSummary.emptyEmails++;
                                if (issue.includes('Placeholders')) issuesSummary.placeholderIssues++;
                                if (issue.includes('civilité')) issuesSummary.civilityConfusion++;
                            });
                        }
                    }
                }
                
                // Si des issues ont été trouvées pour cette entrée
                if (entryIssues.length > 0) {
                    entriesWithIssues++;
                    totalIssues += entryIssues.length;
                    
                    detailedIssues.push({
                        name: fullName,
                        jobTitle: row['JobTitle'] || '',
                        issues: entryIssues
                    });
                }
                
                // Affichage du progrès
                if (totalEntries % 100 === 0) {
                    process.stdout.write(`\r   Processed: ${totalEntries} entries...`);
                }
            })
            .on('end', () => {
                console.log(`\r   ✅ Processed: ${totalEntries} entries`);
                
                // Statistiques des emails
                const avgEmailLength = emailLengthStats.length > 0 ? 
                    Math.round(emailLengthStats.reduce((a, b) => a + b, 0) / emailLengthStats.length) : 0;
                const minEmailLength = emailLengthStats.length > 0 ? Math.min(...emailLengthStats) : 0;
                const maxEmailLength = emailLengthStats.length > 0 ? Math.max(...emailLengthStats) : 0;
                
                // Afficher le rapport
                console.log('\n🎯 ANALYSIS RESULTS');
                console.log('==================');
                
                console.log(`\n📊 Overview:`);
                console.log(`   Total entries analyzed: ${totalEntries}`);
                console.log(`   Total emails found: ${totalEmails}`);
                console.log(`   Entries with issues: ${entriesWithIssues} (${((entriesWithIssues/totalEntries)*100).toFixed(1)}%)`);
                console.log(`   Emails with issues: ${emailsWithIssues} (${totalEmails > 0 ? ((emailsWithIssues/totalEmails)*100).toFixed(1) : 0}%)`);
                console.log(`   Total issues found: ${totalIssues}`);
                
                console.log(`\n📏 Email Length Statistics:`);
                console.log(`   Average length: ${avgEmailLength} characters`);
                console.log(`   Shortest email: ${minEmailLength} characters`);
                console.log(`   Longest email: ${maxEmailLength} characters`);
                
                console.log(`\n🚨 Issues by category:`);
                console.log(`   ├── Groq errors: ${issuesSummary.groqErrors}`);
                console.log(`   ├── Generic emails: ${issuesSummary.genericEmails}`);
                console.log(`   ├── Content errors: ${issuesSummary.contentErrors}`);
                console.log(`   ├── Short emails: ${issuesSummary.shortEmails}`);
                console.log(`   ├── Empty emails: ${issuesSummary.emptyEmails}`);
                console.log(`   ├── Placeholder issues: ${issuesSummary.placeholderIssues}`);
                console.log(`   ├── Civility confusion: ${issuesSummary.civilityConfusion}`);
                console.log(`   └── Job description issues: ${issuesSummary.jobDescriptionIssues}`);
                
                // Afficher quelques exemples détaillés
                if (detailedIssues.length > 0) {
                    console.log(`\n🔍 Sample issues (first 15):`);
                    detailedIssues.slice(0, 15).forEach((entry, index) => {
                        console.log(`\n   ${index + 1}. ${entry.name} - ${entry.jobTitle}`);
                        entry.issues.slice(0, 3).forEach(issue => {
                            console.log(`      ⚠️  ${issue}`);
                        });
                        if (entry.issues.length > 3) {
                            console.log(`      ... and ${entry.issues.length - 3} more issues`);
                        }
                    });
                }
                
                // Recommandations
                console.log(`\n💡 RECOMMENDATIONS:`);
                if (issuesSummary.groqErrors > 0) {
                    console.log(`   🔧 Fix Groq API issues (${issuesSummary.groqErrors} errors found)`);
                }
                if (issuesSummary.genericEmails > 0) {
                    console.log(`   📝 Review email templates (${issuesSummary.genericEmails} generic emails)`);
                }
                if (issuesSummary.shortEmails > 0) {
                    console.log(`   📏 Review short email content (${issuesSummary.shortEmails} short emails)`);
                }
                if (issuesSummary.contentErrors > 0) {
                    console.log(`   🚫 Fix content generation errors (${issuesSummary.contentErrors} content errors)`);
                }
                if (issuesSummary.jobDescriptionIssues > 0) {
                    console.log(`   📋 Fix job description extraction (${issuesSummary.jobDescriptionIssues} issues)`);
                }
                if (totalEmails === 0) {
                    console.log(`   ❌ No emails found - check email generation process`);
                }
                
                console.log('\n✅ Analysis completed!');
                resolve();
            })
            .on('error', (error) => {
                console.error('❌ Error reading CSV file:', error);
                reject(error);
            });
    });
}

// Lancer l'analyse
analyzeData().catch(error => {
    console.error('Critical error during analysis:', error);
    process.exit(1);
}); 