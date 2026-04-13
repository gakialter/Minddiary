const fs = require('fs');

// Patch database.ts
let dbContent = fs.readFileSync('electron/database.ts', 'utf8');
dbContent = dbContent.replace(/let db;/g, 'let db: any;');
dbContent = dbContent.replace(/const Database = require\('better-sqlite3'\);/g, 'const Database = require(\'better-sqlite3\');'); // actually fine
// Fix number assignment to string in migrate database
dbContent = dbContent.replace(/const currentVersion = db\.pragma\('user_version', \{ simple: true \}\);/g, 'const currentVersion = db.pragma(\'user_version\', { simple: true }) as number;');
dbContent = dbContent.replace(/fs\.existsSync\(dbPath\)/g, "fs.existsSync(dbPath as string)");
dbContent = dbContent.replace(/function getAllMistakes\(filters: any = \{\}\) \{/g, 'function getAllMistakes(filters: any = {}) {');

fs.writeFileSync('electron/database.ts', dbContent);

// Patch main.ts
let mainContent = fs.readFileSync('electron/main.ts', 'utf8');
mainContent = mainContent.replace(/let autoUpdater = null;/g, 'let autoUpdater: any = null;');
mainContent = mainContent.replace(/catch \(e\) {/g, 'catch (e: any) {');
mainContent = mainContent.replace(/ipcMain\.handle\('notification:show', \(_, title, body\) => \{/g, 'ipcMain.handle(\'notification:show\', (_: any, title: string, body: string) => {');
mainContent = mainContent.replace(/module.exports = /g, 'module.exports = ');
fs.writeFileSync('electron/main.ts', mainContent);

// Patch fileManager.ts
let fileManagerContent = fs.readFileSync('electron/fileManager.ts', 'utf8');
fileManagerContent = fileManagerContent.replace(/module\.exports = /g, 'module.exports = ');
fs.writeFileSync('electron/fileManager.ts', fileManagerContent);
