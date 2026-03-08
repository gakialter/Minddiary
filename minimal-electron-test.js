// Minimal Electron app for testing
console.log('=== MINIMAL ELECTRON APP TEST ===');
console.log('Process type:', process.type);
console.log('Electron version:', process.versions.electron);
console.log('');

// Test require('electron')
console.log('Testing require("electron"):');
const electron = require('electron');
console.log('Type:', typeof electron);

if (typeof electron === 'object') {
    console.log('✓✓✓ SUCCESS! require("electron") returns object!');
    console.log('Available keys:', Object.keys(electron).slice(0, 15).join(', '));
    console.log('');

    // Try to use app
    const { app, BrowserWindow } = electron;
    console.log('app exists?', !!app);
    console.log('BrowserWindow exists?', !!BrowserWindow);
    console.log('');

    // Try to create window
    app.whenReady().then(() => {
        console.log('✓ app.whenReady() works!');
        const win = new BrowserWindow({
            width: 800,
            height: 600,
            show: false
        });
        console.log('✓ BrowserWindow created!');
        console.log('');
        console.log('=== ALL TESTS PASSED ===');

        // Close after 1 second
        setTimeout(() => {
            app.quit();
        }, 1000);
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

} else {
    console.log('✗✗✗ FAILED: require("electron") returns:', typeof electron);
    console.log('Value:', electron);
}
