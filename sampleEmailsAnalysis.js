require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');

const CSV_FILE_PATH = 'processed/data2.csv';

async function showSampleEmails() {
    console.log('📧 Analyzing sample emails from data2.csv...');
    console.log(`📁 File: ${CSV_FILE_PATH}`);
    
    let entryCount = 0;
    const samples = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                entryCount++;
                
                if (entryCount <= 10) { // Prendre les 10 premiers
                    const firstName = row['FirstName'] || '';
                    const lastName = row['LastName'] || '';
                    const jobTitle = row['JobTitle'] || '';
                    const fullName = `${firstName} ${lastName}`.trim();
                    
                    const sample = {
                        name: fullName,
                        jobTitle: jobTitle,
                        emails: []
                    };
                    
                    // Collecter tous les emails de cette personne
                    for (let emailIndex = 1; emailIndex <= 10; emailIndex++) {
                        const emailColumnName = `Email ${emailIndex}`;
                        const emailContent = row[emailColumnName];
                        
                        if (emailContent && emailContent.trim() !== '') {
                            sample.emails.push({
                                index: emailIndex,
                                content: emailContent.trim()
                            });
                        }
                    }
                    
                    samples.push(sample);
                }
            })
            .on('end', () => {
                console.log('\n🔍 SAMPLE EMAILS ANALYSIS');
                console.log('========================');
                
                samples.forEach((sample, sampleIndex) => {
                    console.log(`\n📝 SAMPLE ${sampleIndex + 1}: ${sample.name} - ${sample.jobTitle}`);
                    console.log(`   Emails found: ${sample.emails.length}`);
                    
                    sample.emails.forEach((email, emailIndex) => {
                        console.log(`\n   📧 EMAIL ${email.index}:`);
                        console.log(`   Length: ${email.content.length} characters`);
                        console.log(`   Content preview (first 200 chars):`);
                        console.log(`   "${email.content.substring(0, 200)}${email.content.length > 200 ? '...' : ''}"`);
                        
                        // Analyser le contenu
                        const issues = [];
                        
                        if (email.content.toLowerCase().includes('test')) {
                            issues.push('Contient "Test"');
                        }
                        if (email.content.toLowerCase().includes('nan')) {
                            issues.push('Contient "NaN"');
                        }
                        if (email.content.toLowerCase().includes('groq')) {
                            issues.push('Erreur Groq');
                        }
                        if (email.content.length < 100) {
                            issues.push('Trop court');
                        }
                        if (email.content.toLowerCase().includes('je ne peux pas') || 
                            email.content.toLowerCase().includes('je suis désolé')) {
                            issues.push('Erreur de génération');
                        }
                        
                        if (issues.length > 0) {
                            console.log(`   ⚠️  Issues detected: ${issues.join(', ')}`);
                        } else {
                            console.log(`   ✅ No obvious issues detected`);
                        }
                        
                        console.log(`   ---`);
                    });
                    
                    console.log('\n' + '='.repeat(80));
                });
                
                // Analyse spécifique des emails contenant "Test" ou "NaN"
                console.log('\n🚨 PROBLEMATIC EMAILS ANALYSIS');
                console.log('==============================');
                
                let testCount = 0;
                let nanCount = 0;
                let groqErrorCount = 0;
                
                samples.forEach(sample => {
                    sample.emails.forEach(email => {
                        if (email.content.toLowerCase().includes('test')) testCount++;
                        if (email.content.toLowerCase().includes('nan')) nanCount++;
                        if (email.content.toLowerCase().includes('groq')) groqErrorCount++;
                    });
                });
                
                console.log(`\n📊 Issues in first ${samples.length} samples:`);
                console.log(`   - Emails containing "Test": ${testCount}`);
                console.log(`   - Emails containing "NaN": ${nanCount}`);
                console.log(`   - Emails with Groq errors: ${groqErrorCount}`);
                
                resolve();
            })
            .on('error', (error) => {
                console.error('❌ Error reading CSV file:', error);
                reject(error);
            });
    });
}

// Lancer l'analyse
showSampleEmails().catch(error => {
    console.error('Critical error during analysis:', error);
    process.exit(1);
}); 