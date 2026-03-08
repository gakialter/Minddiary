// Simple test without requiring electron
console.log('=== BASIC ELECTRON RUNTIME TEST ===');
console.log('Process versions:', JSON.stringify(process.versions, null, 2));
console.log('Process type:', process.type);
console.log('Process argv:', process.argv);
console.log('');

// Check if we're in Electron
if (process.versions.electron) {
    console.log('✓ Running in Electron v' + process.versions.electron);
    console.log('Node version:', process.versions.node);
    console.log('Chrome version:', process.versions.chrome);
    console.log('');
    console.log('This proves Electron can run JavaScript successfully!');
    console.log('The problem is specifically with require("electron")');
} else {
    console.log('✗ Not in Electron');
}

// Exit after 2 seconds
setTimeout(() => {
    console.log('\nExiting...');
    process.exit(0);
}, 2000);
