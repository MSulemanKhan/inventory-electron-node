const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db/sqlite');
const xlsx = require('xlsx');
const archiver = require('archiver');

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

// Export multiple resources as individual XLSX files inside a ZIP
router.get('/export-excel', async (req, res) => {
  const runAll = (sql) => new Promise((resolve, reject) => db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows)));

  try {
    const [products, brands, categories, suppliers, orders] = await Promise.all([
      runAll('SELECT p.*, b.name as brand_name, c.name as category_name, s.name as supplier_name FROM products p LEFT JOIN brands b ON p.brand_id=b.id LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN suppliers s ON p.supplier_id=s.id ORDER BY p.name'),
      runAll('SELECT * FROM brands ORDER BY name'),
      runAll('SELECT * FROM categories ORDER BY name'),
      runAll('SELECT * FROM suppliers ORDER BY name'),
      runAll("SELECT o.*, (SELECT json_group_array(json_object('product_id', oi.product_id, 'product_name', oi.product_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'discount', oi.discount, 'total_price', oi.total_price)) FROM order_items oi WHERE oi.order_id = o.id) as items_json FROM orders o ORDER BY o.created_at DESC")
    ]);

    const mappedOrders = orders.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [] }));

    const buildXlsx = (name, data) => {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(data || []);
      xlsx.utils.book_append_sheet(wb, ws, name);
      return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    };

    const files = [
      { name: 'products.xlsx', buf: buildXlsx('Products', products) },
      { name: 'brands.xlsx', buf: buildXlsx('Brands', brands) },
      { name: 'categories.xlsx', buf: buildXlsx('Categories', categories) },
      { name: 'suppliers.xlsx', buf: buildXlsx('Suppliers', suppliers) },
      { name: 'orders.xlsx', buf: buildXlsx('Orders', mappedOrders) }
    ];

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const zipName = `shah_traders_inventory_backup_${date}.zip`;

    const backupsDir = path.resolve(__dirname, '..', '..', 'backups');
    try { if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}
    // write each XLSX buffer to a temp file first to ensure contents are materialized
    const tmpFiles = [];
    try {
      for (const f of files) {
        const tmpPath = path.join(backupsDir, `tmp_${Date.now()}_${f.name}`);
        fs.writeFileSync(tmpPath, f.buf);
        tmpFiles.push({ path: tmpPath, name: f.name });
      }

      const tmpZipPath = path.join(backupsDir, `tmp_${Date.now()}.zip`);
      const output = fs.createWriteStream(tmpZipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);
        const stream = fs.createReadStream(tmpZipPath);
        stream.on('end', () => {
          try { fs.unlinkSync(tmpZipPath); } catch (e) {}
          // cleanup temp xlsx files
          for (const t of tmpFiles) try { fs.unlinkSync(t.path); } catch (e) {}
        });
        stream.pipe(res);
      });

      archive.on('error', (err) => {
        console.error('Archive error', err);
        try { if (fs.existsSync(tmpZipPath)) fs.unlinkSync(tmpZipPath); } catch (e) {}
        for (const t of tmpFiles) try { fs.unlinkSync(t.path); } catch (e) {}
        if (!res.headersSent) return res.status(500).send({ error: 'Failed to create archive' });
      });

      archive.pipe(output);
      for (const t of tmpFiles) {
        try {
          const st = fs.statSync(t.path);
          console.log(`Temp file for zip: ${t.path} size=${st.size}`);
        } catch (e) {
          console.warn('Could not stat temp file', t.path, e && e.message);
        }
        archive.file(t.path, { name: t.name });
      }

      archive.on('warning', (w) => { console.warn('Archiver warning', w); });
      archive.on('finish', () => { console.log('Archiver finished, total bytes', archive.pointer()); });
      output.on('finish', () => { console.log('Output stream finished'); });
      archive.finalize();
    } catch (err) {
      // cleanup on error
      for (const t of tmpFiles) try { fs.unlinkSync(t.path); } catch (e) {}
      console.error('Failed preparing temp files for zip', err);
      return res.status(500).send({ error: 'Failed to prepare backup files' });
    }

  } catch (e) {
    console.error('Export excel error', e);
    return res.status(500).send({ error: e.message || 'Export failed' });
  }
});
