// Test alternative ways to access Electron API
console.log('=== Testing Alternative Access Methods ===');
console.log('');

// Method 1: Check if process has Electron bindings
console.log('Method 1: process._linkedBinding');
if (typeof process._linkedBinding === 'function') {
    try {
        const names = ['electron_common_app', 'electron_browser_app', 'electron_common_v8_util'];
        for (const name of names) {
            try {
                const binding = process._linkedBinding(name);
                console.log(`✓ ${name}:`, typeof binding);
            } catch (err) {
                console.log(`✗ ${name}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
} else {
    console.log('✗ process._linkedBinding not available');
}
console.log('');

// Method 2: Check process.atomBinding
console.log('Method 2: process.atomBinding (deprecated)');
if (typeof process.atomBinding === 'function') {
    console.log('✓ process.atomBinding exists');
} else {
    console.log('✗ process.atomBinding not found');
}
console.log('');

// Method 3: Check global objects
console.log('Method 3: Check global objects');
console.log('global.require:', typeof global.require);
console.log('global.process:', typeof global.process);
console.log('global.Buffer:', typeof global.Buffer);
console.log('');

// Method 4: List all available native modules
console.log('Method 4: Try to list native modules');
if (process.moduleLoadList) {
    const electronModules = process.moduleLoadList.filter(m => m.includes('electron'));
    console.log('Electron modules loaded:', electronModules.slice(0, 10));
}

console.log('');
console.log('=== END ===');
