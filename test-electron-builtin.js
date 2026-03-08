// Test if Electron has built-in electron module
console.log('=== Electron Built-in Module Test ===');

if (process.versions.electron) {
    console.log('✓ Running in Electron');
    console.log('');

    // Method 1: Check process.electronBinding
    console.log('Method 1: process.electronBinding');
    try {
        if (typeof process.electronBinding === 'function') {
            console.log('✓ process.electronBinding exists');
        } else {
            console.log('✗ process.electronBinding not found');
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
    console.log('');

    // Method 2: Check process._linkedBinding
    console.log('Method 2: process._linkedBinding');
    try {
        if (typeof process._linkedBinding === 'function') {
            console.log('✓ process._linkedBinding exists');
            const electron = process._linkedBinding('electron_common_v8_util');
            console.log('Result:', typeof electron);
        } else {
            console.log('✗ process._linkedBinding not found');
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
    console.log('');

    // Method 3: Try to access built-in modules
    console.log('Method 3: Check module cache');
    console.log('Cached modules:', Object.keys(require.cache).filter(k => k.includes('electron')));
    console.log('');

    // Method 4: Try alternative import
    console.log('Method 4: Delete cache and re-require');
    try {
        // Find the electron module in cache
        const electronModulePath = require.resolve('electron');
        console.log('Resolved path:', electronModulePath);

        // Check if Electron overrides require
        console.log('Module._load:', typeof require('module')._load);
    } catch (err) {
        console.error('Error:', err.message);
    }
} else {
    console.log('✗ Not in Electron process');
}

console.log('=== END ===');
