const fs = require('fs');

(async () => {
    try {
        const module = await import('png-to-ico');
        const pngToIco = module.default || module;
        const buf = await pngToIco('build/icon.png');
        fs.writeFileSync('build/icon.ico', buf);
        console.log('Icon successfully converted to ICO!');
    } catch (e) {
        console.error('Failed to convert icon:', e);
    }
})();
