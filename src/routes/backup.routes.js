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

// Download a consistent DB snapshot as backup using VACUUM INTO (fallback to file copy)
router.get('/download', (req, res) => {
  const dbPath = path.resolve(__dirname, '..', '..', 'inventory.db');
  if (!fs.existsSync(dbPath)) return res.status(404).send({ error: 'Database file not found' });

  const backupsDir = path.resolve(__dirname, '..', '..', 'backups');
  try { if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}

  const filename = backupFilename();
  const backupPath = path.join(backupsDir, filename);

  // Try VACUUM INTO first for a reliable, checkpointed snapshot
  const escaped = backupPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
  const vacuumSql = `PRAGMA wal_checkpoint(TRUNCATE); VACUUM INTO '${escaped}';`;

  db.exec(vacuumSql, (vacErr) => {
    const pipeFile = () => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      const stream = fs.createReadStream(backupPath);
      stream.on('error', (err) => { res.status(500).send({ error: 'Failed to read backup file' }); });
      // Optionally clean up the backup after sending
      stream.on('close', () => { try { fs.unlinkSync(backupPath); } catch (e) {} });
      stream.pipe(res);
    };

    if (!vacErr && fs.existsSync(backupPath)) {
      return pipeFile();
    }

    // Fallback: acquire an IMMEDIATE transaction to block writers, checkpoint WAL, then copy file
    db.exec('BEGIN IMMEDIATE; PRAGMA wal_checkpoint(TRUNCATE);', (beginErr) => {
      if (beginErr) {
        return res.status(500).send({ error: 'Failed to create backup snapshot', details: String(beginErr.message || beginErr) });
      }
      fs.copyFile(dbPath, backupPath, (cpErr) => {
        // Commit or rollback regardless of copy result
        const endSql = cpErr ? 'ROLLBACK;' : 'COMMIT;';
        db.exec(endSql, () => {
          if (cpErr) {
            return res.status(500).send({ error: 'Failed to copy database file for backup', details: String(cpErr.message || cpErr) });
          }
          return pipeFile();
        });
      });
    });
  });
});

// Restore DB from uploaded raw binary (application/octet-stream)
// Note: this will overwrite the current inventory.db file. Server process may need restart.
router.post('/restore', express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req, res) => {
  try {
    if (!req.body || req.body.length === 0) return res.status(400).send({ error: 'No file uploaded' });
    const dbPath = path.resolve(__dirname, '..', '..', 'inventory.db');

    const backupsDir = path.resolve(__dirname, '..', '..', 'backups');
    try { if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}
    const savedName = `restored-${Date.now()}.db`;
    const savedPath = path.join(backupsDir, savedName);

    // Save uploaded buffer to backups folder
    fs.writeFile(savedPath, req.body, (writeErr) => {
      if (writeErr) return res.status(500).send({ error: 'Failed to save uploaded backup', details: String(writeErr.message || writeErr) });

      // Import data from saved backup into live DB via ATTACH to avoid replacing locked file
      function importBackupFile(uploadedPath, cb) {
        const attachPath = uploadedPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
        const tables = [
          'brands', 'categories', 'suppliers',
          'products', 'inventory_transactions', 'orders', 'order_items'
        ];
        let stmts = "PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n";
        stmts += `ATTACH DATABASE '${attachPath}' AS src;\n`;
        tables.forEach(t => {
          stmts += `DELETE FROM ${t};\n`;
          stmts += `INSERT INTO ${t} SELECT * FROM src.${t};\n`;
        });
        // AUTOINCREMENT state will naturally adjust based on existing IDs
        stmts += `DETACH DATABASE src;\nCOMMIT;\nPRAGMA foreign_keys = ON;\n`;

        db.exec(stmts, (importErr) => {
          if (importErr) return cb(importErr);
          return cb(null);
        });
      }

      importBackupFile(savedPath, (importErr) => {
        if (!importErr) {
          return res.status(200).send({ message: `Backup imported successfully from ${path.relative(process.cwd(), savedPath)}. Restart is not required.`, savedPath });
        }

        // If import fails, last resort: replace the DB file on disk (may require restart)
        const tmpPath = dbPath + '.restore.tmp';
        fs.writeFile(tmpPath, req.body, (tmpErr) => {
          if (tmpErr) return res.status(500).send({ error: 'Failed to write temporary restore file', details: String(tmpErr.message || tmpErr) });
          fs.rename(tmpPath, dbPath, (rErr) => {
            if (rErr) {
              console.error('Rename failed during restore, manual replacement may be required:', rErr);
              try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
              return res.status(200).send({ message: `Backup uploaded to ${path.relative(process.cwd(), savedPath)} but automatic restore failed. Stop the backend and replace inventory.db with this file, then restart the app.`, savedPath, importError: String(importErr.message || importErr) });
            }
            return res.status(200).send({ message: 'Database file replaced successfully. Please restart the application.' });
          });
        });
      });
    });
  } catch (e) {
    return res.status(500).send({ error: 'Restore failed', details: e.message });
  }
});

module.exports = router;
