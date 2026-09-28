const fs = require('fs');
const path = require('path');

// Define the path to the 'word' directory inside 'public'
const wordDir = path.join(__dirname, 'word');
// Check if the directory exists
if (!fs.existsSync(wordDir)) {
    console.error('❌ Error: Directory public/word does not exist.');
    process.exit(1);
}

const files = fs.readdirSync(wordDir);
let successCount = 0;

files.forEach(file => {
    // Only process .html files
    if (!file.endsWith('.html')) return;

    const filePath = path.join(wordDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Find the canonical link to extract the correct Arabic word
    const match = content.match(/href="https:\/\/ghareebalquran\.com\/word\/([^"]+)\.html"/);

    if (match && match[1]) {
        let correctName = match[1];

        // Decode URL if it is URL-encoded
        try {
            correctName = decodeURIComponent(correctName);
        } catch (e) {}

        const newFilePath = path.join(wordDir, `${correctName}.html`);

        // Rename the file
        if (filePath !== newFilePath) {
            fs.renameSync(filePath, newFilePath);
            console.log(`Fixed: ${file} ➔ ${correctName}.html`);
            successCount++;
        }
    }
});

console.log(`\n✅ Operation complete! Renamed ${successCount} files successfully.`);