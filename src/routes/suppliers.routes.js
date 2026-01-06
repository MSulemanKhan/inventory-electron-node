const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const upload = multer({ dest: path.join(__dirname, '../../uploads') });

// Get all suppliers
router.get("/", (req, res) => {
  db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Delete all suppliers
router.delete('/delete-all', (req, res) => {
  db.run('DELETE FROM suppliers', [], function(err) {
    if (err) return res.status(500).send(err);
    res.send({ message: 'All suppliers deleted', rows: this.changes });
  });
});

// Export suppliers
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toString().toLowerCase();
  db.all('SELECT * FROM suppliers ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).send(err);
    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Suppliers');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="suppliers.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }
    const headers = Object.keys(rows[0] || { name: 'Name', contact_person: 'Contact', email: 'Email', phone: 'Phone', address: 'Address' });
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = headers.map(h => { let v = r[h]; if (v === null || v === undefined) v = ''; if (typeof v === 'string' && v.includes(',')) v = '"' + v.replace(/"/g, '""') + '"'; return v; }).join(',');
      csvRows.push(line);
    }
    res.setHeader('Content-Disposition', 'attachment; filename="suppliers.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  });
});

// Import suppliers (CSV/XLSX)
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send({ error: 'File is required' });
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  try {
    let records = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      records = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      const raw = fs.readFileSync(filePath, 'utf8');
      records = parse(raw, { columns: true, skip_empty_lines: true });
    }
    const results = { created: 0, updated: 0, errors: 0 };
    const tasks = records.map(row => (done) => {
      const name = (row.name || row.Name || '').toString().trim();
      const contact_person = row.contact_person || row.Contact || '';
      const email = row.email || '';
      const phone = row.phone || '';
      const address = row.address || '';
      if (!name) { results.errors++; return done(null); }
      db.get('SELECT id FROM suppliers WHERE name = ?', [name], (e, ex) => {
        if (e) { results.errors++; return done(e); }
        if (ex && ex.id) {
          db.run('UPDATE suppliers SET contact_person=?, email=?, phone=?, address=? WHERE id = ?', [contact_person, email, phone, address, ex.id], function(uerr) {
            if (uerr) { results.errors++; return done(uerr); }
            results.updated++; return done(null);
          });
        } else {
          db.run('INSERT INTO suppliers(name, contact_person, email, phone, address) VALUES (?,?,?,?,?)', [name, contact_person, email, phone, address], function(ierr) {
            if (ierr) { results.errors++; return done(ierr); }
            results.created++; return done(null);
          });
        }
      });
    });
    (function runNext(i) { if (i >= tasks.length) { try { fs.unlinkSync(filePath); } catch (e) {} return res.send(results); } tasks[i]((err) => { if (err) console.error('Import supplier row error', err && err.message); runNext(i+1); }); })(0);
  } catch (e) { try { fs.unlinkSync(filePath); } catch (er) {} return res.status(500).send({ error: e.message || 'Import failed' }); }
});

// Get single supplier
router.get("/:id", (req, res) => {
  db.get("SELECT * FROM suppliers WHERE id = ?", [req.params.id], (err, row) => {
    if (err) res.status(500).send(err);
    else if (!row) res.status(404).send({ error: "Supplier not found" });
    else res.send(row);
  });
});

// Create supplier
router.post("/", (req, res) => {
  const { name, contact_person, email, phone, address } = req.body;
  db.run("INSERT INTO suppliers(name, contact_person, email, phone, address) VALUES (?, ?, ?, ?, ?)",
    [name, contact_person, email, phone, address],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID, message: "Supplier created successfully" });
    });
});

// Update supplier
router.put("/:id", (req, res) => {
  const { name, contact_person, email, phone, address } = req.body;
  db.run("UPDATE suppliers SET name = ?, contact_person = ?, email = ?, phone = ?, address = ? WHERE id = ?",
    [name, contact_person, email, phone, address, req.params.id],
    function(err) {
      if (err) res.status(500).send(err);
      else if (this.changes === 0) res.status(404).send({ error: "Supplier not found" });
      else res.send({ message: "Supplier updated successfully" });
    });
});

// Delete supplier
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM suppliers WHERE id = ?", [req.params.id], function(err) {
    if (err) res.status(500).send(err);
    else if (this.changes === 0) res.status(404).send({ error: "Supplier not found" });
    else res.send({ message: "Supplier deleted successfully" });
  });
});

// Delete all suppliers
router.delete('/delete-all', (req, res) => {
  db.run('DELETE FROM suppliers', [], function(err) {
    if (err) return res.status(500).send(err);
    res.send({ message: 'All suppliers deleted', rows: this.changes });
  });
});

// Export suppliers
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toString().toLowerCase();
  db.all('SELECT * FROM suppliers ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).send(err);
    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Suppliers');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="suppliers.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }
    const headers = Object.keys(rows[0] || { name: 'Name', contact_person: 'Contact', email: 'Email', phone: 'Phone', address: 'Address' });
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = headers.map(h => { let v = r[h]; if (v === null || v === undefined) v = ''; if (typeof v === 'string' && v.includes(',')) v = '"' + v.replace(/"/g, '""') + '"'; return v; }).join(',');
      csvRows.push(line);
    }
    res.setHeader('Content-Disposition', 'attachment; filename="suppliers.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  });
});

// Import suppliers (CSV/XLSX)
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send({ error: 'File is required' });
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  try {
    let records = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      records = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      const raw = fs.readFileSync(filePath, 'utf8');
      records = parse(raw, { columns: true, skip_empty_lines: true });
    }
    const results = { created: 0, updated: 0, errors: 0 };
    const tasks = records.map(row => (done) => {
      const name = (row.name || row.Name || '').toString().trim();
      const contact_person = row.contact_person || row.Contact || '';
      const email = row.email || '';
      const phone = row.phone || '';
      const address = row.address || '';
      if (!name) { results.errors++; return done(null); }
      db.get('SELECT id FROM suppliers WHERE name = ?', [name], (e, ex) => {
        if (e) { results.errors++; return done(e); }
        if (ex && ex.id) {
          db.run('UPDATE suppliers SET contact_person=?, email=?, phone=?, address=? WHERE id = ?', [contact_person, email, phone, address, ex.id], function(uerr) {
            if (uerr) { results.errors++; return done(uerr); }
            results.updated++; return done(null);
          });
        } else {
          db.run('INSERT INTO suppliers(name, contact_person, email, phone, address) VALUES (?,?,?,?,?)', [name, contact_person, email, phone, address], function(ierr) {
            if (ierr) { results.errors++; return done(ierr); }
            results.created++; return done(null);
          });
        }
      });
    });
    (function runNext(i) { if (i >= tasks.length) { try { fs.unlinkSync(filePath); } catch (e) {} return res.send(results); } tasks[i]((err) => { if (err) console.error('Import supplier row error', err && err.message); runNext(i+1); }); })(0);
  } catch (e) { try { fs.unlinkSync(filePath); } catch (er) {} return res.status(500).send({ error: e.message || 'Import failed' }); }
});

module.exports = router;
