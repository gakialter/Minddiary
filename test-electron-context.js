// Test if this file runs inside Electron process or Node.js process
console.log('=== CONTEXT TEST ===');
console.log('Process type:', process.type); // 在 Electron 中应该是 'browser'
console.log('Process versions:', JSON.stringify(process.versions, null, 2));
console.log('');

// Check if running in Electron
if (process.versions.electron) {
    console.log('✓ Running in Electron process');
    console.log('Electron version:', process.versions.electron);
    console.log('');

    // Now test require('electron')
    console.log('Testing require("electron") in Electron context:');
    const electron = require('electron');
    console.log('Type:', typeof electron);

    if (typeof electron === 'object') {
        console.log('✓ require("electron") returns object!');
        console.log('Available keys:', Object.keys(electron).slice(0, 10).join(', '));

        const { app } = electron;
        console.log('app exists?', !!app);
        console.log('app.whenReady?', typeof app.whenReady);
    } else {
        console.log('✗ require("electron") returns:', typeof electron);
        console.log('Value:', electron);
    }
} else {
    console.log('✗ NOT running in Electron process');
    console.log('This is plain Node.js');
    console.log('');
    console.log('require("electron") will return:', require('electron'));
}

console.log('=== END ===');
