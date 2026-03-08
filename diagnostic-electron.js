// Diagnostic Test: Check what require('electron') actually returns
console.log('=== DIAGNOSTIC TEST START ===');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('');

// Test 1: What does require('electron') return?
console.log('Test 1: require("electron") in Node.js context');
try {
    const electronPath = require('electron');
    console.log('Type:', typeof electronPath);
    console.log('Value:', electronPath);
    console.log('Is string?', typeof electronPath === 'string');
    console.log('');
} catch (err) {
    console.error('Error requiring electron:', err.message);
}

// Test 2: Check electron module structure
console.log('Test 2: Check node_modules/electron/index.js');
try {
    const path = require('path');
    const electronModulePath = path.join(__dirname, 'node_modules', 'electron', 'index.js');
    console.log('Module path:', electronModulePath);

    const fs = require('fs');
    if (fs.existsSync(electronModulePath)) {
        const content = fs.readFileSync(electronModulePath, 'utf-8');
        console.log('Module content (first 300 chars):');
        console.log(content.substring(0, 300));
    } else {
        console.log('ERROR: electron module index.js not found!');
    }
    console.log('');
} catch (err) {
    console.error('Error checking module:', err.message);
}

// Test 3: Check if electron executable exists
console.log('Test 3: Check electron executable');
try {
    const path = require('path');
    const fs = require('fs');
    const electronExePath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
    console.log('Expected exe path:', electronExePath);
    console.log('Exists?', fs.existsSync(electronExePath));

    if (fs.existsSync(electronExePath)) {
        const stats = fs.statSync(electronExePath);
        console.log('Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
    }
    console.log('');
} catch (err) {
    console.error('Error checking executable:', err.message);
}

// Test 4: Try to run electron with --version
console.log('Test 4: Run electron --version');
try {
    const { execSync } = require('child_process');
    const output = execSync('npx electron --version', { encoding: 'utf-8' });
    console.log('Output:', output.trim());
    console.log('');
} catch (err) {
    console.error('Error running electron:', err.message);
}

console.log('=== DIAGNOSTIC TEST END ===');
