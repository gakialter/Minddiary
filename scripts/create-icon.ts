import * as fs from 'node:fs';
import * as path from 'node:path';

try {
    const buildDir = path.join(__dirname, '..', 'build');
    const sourceIcon = path.join(__dirname, '..', 'docs', 'assets', 'app-icon.png');
    const pngIcon = path.join(buildDir, 'icon.png');

    fs.mkdirSync(buildDir, { recursive: true });
    fs.copyFileSync(sourceIcon, pngIcon);
    console.log('Icon successfully copied to build/icon.png');
} catch (e) {
    console.error('Failed to prepare icon:', e);
}
