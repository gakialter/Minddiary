const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu'); // prevent headless errors on windows

app.whenReady().then(() => {
  try {
    const db = require('./electron/database');
    const fileManager = require('./electron/fileManager');

    db.initialize(); // <-- Missing initialization that caused the crash!

    console.log('==========================================');
    console.log('🚀 Phase 11 Backend Fixes Verification Run');
    console.log('==========================================\n');

    // 1. Verify Memory Leak Fix
    console.log('🔍 [TEST 1] Memory Leak Fix (getAllEntries content stripping)');
    
    // Create a dummy entry
    const entryId = db.createEntry({
      date: '2026-06-15',
      title: 'Memory Optimization Test',
      content: 'This massive text block should NEVER be loaded into React Context state during initial boot or sidebar listing! By stripping it, we save hundreds of megabytes of RAM over time.',
      mood: 'happy',
      tags: []
    }).id;

    const list = db.getAllEntries({});
    const createdEntry = list.find(e => e.id === entryId);
    
    if (createdEntry.content !== undefined) {
      console.error('❌ FAILED: getAllEntries returned "content" field');
      app.exit(1);
    } else {
      console.log('  ✅ PASSED: getAllEntries successfully stripped "content" field for list views');
    }

    const fullExportList = db.getAllEntries({ includeContent: true });
    const fullEntry = fullExportList.find(e => e.id === entryId);
    if (!fullEntry || fullEntry.content === undefined) {
        console.error('❌ FAILED: getAllEntries({includeContent: true}) failed to return content');
        app.exit(1);
    } else {
        console.log('  ✅ PASSED: getAllEntries({includeContent: true}) included content for backups');
    }

    const fetchedById = db.getEntryById(entryId);
    if (!fetchedById || !fetchedById.content) {
        console.error('❌ FAILED: getEntryById failed to return proper content');
        app.exit(1);
    } else {
        console.log('  ✅ PASSED: getEntryById successfully loads full content on-demand');
    }


    // 2. Verify Disk Leak Fix
    console.log('\n🔍 [TEST 2] Disk Leak Fix (Attachment Physical Deletion)');
    
    // Create a dummy attachment file
    const userDataPath = app.getPath('userData');
    const attachmentsDir = path.join(userDataPath, 'attachments');
    if (!fs.existsSync(attachmentsDir)) {
      fs.mkdirSync(attachmentsDir, { recursive: true });
    }
    const fakeFileName = `test-attach-${Date.now()}.png`;
    const fakeFilePath = path.join(attachmentsDir, fakeFileName);
    fs.writeFileSync(fakeFilePath, 'dummy image data');

    // Save attachment record to DB
    const attachId = db.addAttachment(entryId, {
      filename: 'test.png',
      filepath: fakeFileName, // fileManager expects just the filename here to join with attachmentsDir
      mimetype: 'image/png'
    }).id;

    if (!fs.existsSync(fakeFilePath)) {
      console.error('❌ SETUP FAILED: Fake attachment file was not created');
      app.exit(1);
    }

    // Call the file deletion function
    fileManager.deleteAttachmentsForEntry(entryId);

    if (fs.existsSync(fakeFilePath)) {
      console.error('❌ FAILED: deleteAttachmentsForEntry did not physically delete the file. Disk leak is still present.');
      app.exit(1);
    } else {
      console.log('  ✅ PASSED: fileManager.deleteAttachmentsForEntry physically deleted the file from disk');
    }

    // Clean up DB
    db.deleteEntry(entryId);

    console.log('\n==========================================');
    console.log('🏆 ALL BACKEND VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('==========================================');
    app.exit(0);

  } catch (err) {
    console.error('Verification crashed:', err);
    app.exit(1);
  }
});
