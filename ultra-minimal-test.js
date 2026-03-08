// Absolute minimal test
console.log('Process type:', process.type);
console.log('Electron?:', process.versions.electron);
console.log('');

if (!process.versions.electron) {
    console.error('ERROR: Not running in Electron!');
    process.exit(1);
}

// Try process.electronBinding (Electron internal API)
if (typeof process.electronBinding === 'function') {
    console.log('Using process.electronBinding');
    try {
        const { app } = process.electronBinding('electron_browser_app');
        console.log('Got app via electronBinding:', typeof app);
    } catch (err) {
        console.error('electronBinding failed:', err.message);
    }
}

// Try require without npm package
console.log('\nTrying to get Electron API...');
try {
    // Method 1: Standard require
    const electron1 = require('electron');
    console.log('Method 1 - require("electron"):', typeof electron1);

    // Method 2: Try to require from Electron's resources
    const electron2 = require('electron/main');
    console.log('Method 2 - require("electron/main"):', typeof electron2);
} catch (err) {
    console.error('Error:', err.message);
}

console.log('\nIf both methods return string, Electron installation is broken.');
