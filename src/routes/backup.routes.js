const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db/sqlite');

// Helper to generate filename
function backupFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `shah-trader-backup-${date}.db`;
}

// Download current DB file as backup
router.get('/download', (req, res) => {
  const dbPath = path.resolve(__dirname, '..', '..', 'inventory.db');
  if (!fs.existsSync(dbPath)) return res.status(404).send({ error: 'Database file not found' });

  const filename = backupFilename();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  const stream = fs.createReadStream(dbPath);
  stream.on('error', (err) => { res.status(500).send({ error: 'Failed to read database file' }); });
  stream.pipe(res);
});

// Restore DB from uploaded raw binary (application/octet-stream)
// Note: this will overwrite the current inventory.db file. Server process may need restart.
router.post('/restore', express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req, res) => {
  try {
    if (!req.body || req.body.length === 0) return res.status(400).send({ error: 'No file uploaded' });
    const dbPath = path.resolve(__dirname, '..', '..', 'inventory.db');
    // Write to a temporary file first
    const tmpPath = dbPath + '.restore.tmp';
    fs.writeFile(tmpPath, req.body, (err) => {
      if (err) return res.status(500).send({ error: 'Failed to write backup file', details: err.message });
      // Move temp file to actual db path (atomic on most platforms)
      fs.rename(tmpPath, dbPath, (rErr) => {
        if (rErr) {
          // On Windows the DB file may be locked; instead save the uploaded buffer to a backups folder and instruct manual replacement
          console.error('Rename failed when restoring DB, will save uploaded backup to backups/ folder:', rErr);
          try {
            const backupsDir = path.resolve(__dirname, '..', '..', 'backups');
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
            const savedName = `restored-${Date.now()}.db`;
            const savedPath = path.join(backupsDir, savedName);
            // Write directly from the received body to the backups file (safer than rename)
            fs.writeFile(savedPath, req.body, (writeErr) => {
              if (writeErr) {
                console.error('Failed to write restore file to backups folder:', writeErr);
                // Clean up temp file
                try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { console.error('Failed to unlink tmpPath', e); }
                return res.status(500).send({ error: 'Failed to replace database file and failed to save backup.', details: String(writeErr.message || writeErr) });
              }
              // Remove temp file if it still exists
              try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
              // Attempt to import data from the saved DB into the live DB (avoids replacing the file while locked)
              function importBackupFile(uploadedPath, cb) {
                const attachPath = uploadedPath.replace(/\\/g, "\\\\");
                // Tables to copy (in order that reduces FK issues)
                const tables = [
                  'brands', 'categories', 'suppliers',
                  'products', 'inventory_transactions', 'orders', 'order_items'
                ];
                // Build SQL to attach and copy tables
                let stmts = "PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n";
                stmts += `ATTACH DATABASE '${attachPath}' AS src;\n`;
                tables.forEach(t => {
                  stmts += `DELETE FROM ${t};\n`;
                  stmts += `INSERT INTO ${t} SELECT * FROM src.${t};\n`;
                });
                // copy sqlite_sequence if present to preserve AUTOINCREMENT values
                stmts += `DELETE FROM sqlite_sequence;\n`;
                stmts += `INSERT OR REPLACE INTO sqlite_sequence SELECT * FROM src.sqlite_sequence;\n`;
                stmts += `DETACH DATABASE src;\nCOMMIT;\nPRAGMA foreign_keys = ON;\n`;

                db.exec(stmts, (importErr) => {
                  if (importErr) return cb(importErr);
                  return cb(null);
                });
              }

              importBackupFile(savedPath, (importErr) => {
                if (importErr) {
                  console.error('Failed to import backup into live DB:', importErr);
                  return res.status(200).send({ message: `Backup uploaded and saved to ${path.relative(process.cwd(), savedPath)} but automatic import failed. To apply it, stop the backend and replace inventory.db with this file, then restart the app.`, savedPath, importError: String(importErr.message || importErr) });
                }
                return res.status(200).send({ message: `Backup uploaded, saved to ${path.relative(process.cwd(), savedPath)} and imported into the live database. Restarting is not required for data to appear.`, savedPath });
              });
            });
          } catch (e) {
            console.error('Unexpected error during restore fallback:', e);
            return res.status(500).send({ error: 'Failed to replace database file', details: String(e.message || e) });
          }
          return;
        }
        // Success
        return res.send({ message: 'Database restored successfully. Please restart the application to ensure changes are applied.' });
      });
    });
  } catch (e) {
    return res.status(500).send({ error: 'Restore failed', details: e.message });
  }
});

module.exports = router;
