const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');

const upload = multer({ dest: path.join(__dirname, '../../uploads') });

// Get all products with related data
router.get("/", (req, res) => {
  const query = `
    SELECT p.*, b.name as brand_name, c.name as category_name, s.name as supplier_name
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ORDER BY p.created_at DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Get low stock products (placed before param routes)
router.get("/alerts/low-stock", (req, res) => {
  const query = `
    SELECT p.*, b.name as brand_name, c.name as category_name
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.quantity <= p.reorder_level
    ORDER BY p.quantity ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Export products as CSV or XLSX (placed before param routes)
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toString().toLowerCase();
  const query = `SELECT p.*, b.name as brand_name, c.name as category_name, s.name as supplier_name FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ORDER BY p.created_at DESC`;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send(err);

    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    // default CSV
    const headers = Object.keys(rows[0] || { name: 'Name', sku: 'SKU', price: 'Price' });
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = headers.map(h => {
        let v = r[h];
        if (v === null || v === undefined) v = '';
        if (typeof v === 'string' && v.includes(',')) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(',');
      csvRows.push(line);
    }
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  });
});

// Import products (CSV or XLSX) (placed before param routes)
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send({ error: 'File is required' });
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let records = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      records = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      const raw = fs.readFileSync(filePath, 'utf8');
      records = parse(raw, { columns: true, skip_empty_lines: true });
    }

    const results = { created: 0, updated: 0, errors: 0 };
    const tasks = records.map(row => (done) => {
      const r = {};
      for (const k of Object.keys(row)) r[k.toLowerCase().trim()] = row[k];

      const name = r.name || r.product_name;
      if (!name) return done(new Error('Missing product name'));

      const sku = r.sku || null;
      const description = r.description || '';
      const quantity = Number(r.quantity || 0) || 0;
      const price = Number(r.price || 0) || 0;
      const discount = Number(r.discount || 0) || 0;
      const cost = r.cost ? Number(r.cost) : null;
      const reorder_level = Number(r.reorder_level || 10) || 10;
      const unit = r.unit || 'pcs';

      const brandName = r.brand || r.brand_name;
      const categoryName = r.category || r.category_name;
      const supplierName = r.supplier || r.supplier_name;

      findOrCreate('brands', brandName, (errB, brand_id) => {
        if (errB) return done(errB);
        findOrCreate('categories', categoryName, (errC, category_id) => {
          if (errC) return done(errC);
          findOrCreate('suppliers', supplierName, (errS, supplier_id) => {
            if (errS) return done(errS);

            if (sku) {
              db.get('SELECT id FROM products WHERE sku = ?', [sku], (errP, existing) => {
                if (errP) return done(errP);
                if (existing && existing.id) {
                  const q = `UPDATE products SET name=?, description=?, quantity=?, price=?, discount=?, cost=?, brand_id=?, category_id=?, supplier_id=?, reorder_level=?, unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`;
                  db.run(q, [name, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit, existing.id], function(uerr) {
                    if (uerr) { results.errors++; return done(uerr); }
                    results.updated++; return done(null);
                  });
                } else {
                  const q = `INSERT INTO products(name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
                  db.run(q, [name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit], function(ierr) {
                    if (ierr) { results.errors++; return done(ierr); }
                    results.created++; return done(null);
                  });
                }
              });
            } else {
              const q = `INSERT INTO products(name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
              db.run(q, [name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit], function(ierr) {
                if (ierr) { results.errors++; return done(ierr); }
                results.created++; return done(null);
              });
            }
          });
        });
      });
    });

    (function runNext(i) {
      if (i >= tasks.length) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.send(results);
      }
      tasks[i]((err) => {
        if (err) console.error('Import row error:', err && err.message);
        runNext(i+1);
      });
    })(0);

  } catch (e) {
    try { fs.unlinkSync(filePath); } catch (er) {}
    console.error('Import error:', e && e.message);
    return res.status(500).send({ error: e.message || 'Import failed' });
  }
});

// Get single product
router.get("/:id", (req, res) => {
  const query = `
    SELECT p.*, b.name as brand_name, c.name as category_name, s.name as supplier_name
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.id = ?
  `;
  db.get(query, [req.params.id], (err, row) => {
    if (err) res.status(500).send(err);
    else if (!row) res.status(404).send({ error: "Product not found" });
    else res.send(row);
  });
});

// Add product
router.post("/", (req, res) => {
  const { name, sku, description, quantity, price, discount = 0, cost, brand_id, category_id, supplier_id, reorder_level, unit } = req.body;
  const query = `INSERT INTO products(name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [name, sku, description, quantity || 0, price, discount || 0, cost, brand_id, category_id, supplier_id, reorder_level || 10, unit || 'pcs'],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID, message: "Product created successfully" });
    });
});

// Update product
router.put("/:id", (req, res) => {
  const { name, sku, description, quantity, price, discount = 0, cost, brand_id, category_id, supplier_id, reorder_level, unit } = req.body;
  const query = `UPDATE products 
                 SET name = ?, sku = ?, description = ?, quantity = ?, price = ?, discount = ?, cost = ?, 
                     brand_id = ?, category_id = ?, supplier_id = ?, reorder_level = ?, unit = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`;
  
  db.run(query, [name, sku, description, quantity, price, discount || 0, cost, brand_id, category_id, supplier_id, reorder_level, unit, req.params.id],
    function(err) {
      if (err) res.status(500).send(err);
      else if (this.changes === 0) res.status(404).send({ error: "Product not found" });
      else res.send({ message: "Product updated successfully" });
    });
});

// Delete product
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
    if (err) res.status(500).send(err);
    else if (this.changes === 0) res.status(404).send({ error: "Product not found" });
    else res.send({ message: "Product deleted successfully" });
  });
});

// Get low stock products
router.get("/alerts/low-stock", (req, res) => {
  const query = `
    SELECT p.*, b.name as brand_name, c.name as category_name
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.quantity <= p.reorder_level
    ORDER BY p.quantity ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Export products as CSV or XLSX
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toString().toLowerCase();
  const query = `SELECT p.*, b.name as brand_name, c.name as category_name, s.name as supplier_name FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    ORDER BY p.created_at DESC`;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send(err);

    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Products');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    // default CSV
    const headers = Object.keys(rows[0] || { name: 'Name', sku: 'SKU', price: 'Price' });
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = headers.map(h => {
        let v = r[h];
        if (v === null || v === undefined) v = '';
        // escape double quotes
        if (typeof v === 'string' && v.includes(',')) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(',');
      csvRows.push(line);
    }
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  });
});

// Helper to find or create related entity by name
function findOrCreate(table, name, cb) {
  if (!name) return cb(null, null);
  db.get(`SELECT id FROM ${table} WHERE name = ?`, [name], (err, row) => {
    if (err) return cb(err);
    if (row && row.id) return cb(null, row.id);
    db.run(`INSERT INTO ${table}(name) VALUES (?)`, [name], function(err2) {
      if (err2) return cb(err2);
      cb(null, this.lastID);
    });
  });
}

// Import products (CSV or XLSX)
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send({ error: 'File is required' });
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let records = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      records = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else {
      const raw = fs.readFileSync(filePath, 'utf8');
      records = parse(raw, { columns: true, skip_empty_lines: true });
    }

    // Process rows sequentially
    const results = { created: 0, updated: 0, errors: 0 };
    const tasks = records.map(row => (done) => {
      // normalize keys (lowercase)
      const r = {};
      for (const k of Object.keys(row)) r[k.toLowerCase().trim()] = row[k];

      const name = r.name || r.product_name;
      if (!name) return done(new Error('Missing product name'));

      const sku = r.sku || null;
      const description = r.description || '';
      const quantity = Number(r.quantity || 0) || 0;
      const price = Number(r.price || 0) || 0;
      const discount = Number(r.discount || 0) || 0;
      const cost = r.cost ? Number(r.cost) : null;
      const reorder_level = Number(r.reorder_level || 10) || 10;
      const unit = r.unit || 'pcs';

      const brandName = r.brand || r.brand_name;
      const categoryName = r.category || r.category_name;
      const supplierName = r.supplier || r.supplier_name;

      // resolve relations
      findOrCreate('brands', brandName, (errB, brand_id) => {
        if (errB) return done(errB);
        findOrCreate('categories', categoryName, (errC, category_id) => {
          if (errC) return done(errC);
          findOrCreate('suppliers', supplierName, (errS, supplier_id) => {
            if (errS) return done(errS);

            // if SKU provided, try update existing
            if (sku) {
              db.get('SELECT id FROM products WHERE sku = ?', [sku], (errP, existing) => {
                if (errP) return done(errP);
                if (existing && existing.id) {
                  const q = `UPDATE products SET name=?, description=?, quantity=?, price=?, discount=?, cost=?, brand_id=?, category_id=?, supplier_id=?, reorder_level=?, unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`;
                  db.run(q, [name, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit, existing.id], function(uerr) {
                    if (uerr) { results.errors++; return done(uerr); }
                    results.updated++; return done(null);
                  });
                } else {
                  const q = `INSERT INTO products(name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
                  db.run(q, [name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit], function(ierr) {
                    if (ierr) { results.errors++; return done(ierr); }
                    results.created++; return done(null);
                  });
                }
              });
            } else {
              const q = `INSERT INTO products(name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
              db.run(q, [name, sku, description, quantity, price, discount, cost, brand_id, category_id, supplier_id, reorder_level, unit], function(ierr) {
                if (ierr) { results.errors++; return done(ierr); }
                results.created++; return done(null);
              });
            }
          });
        });
      });
    });

    // execute sequentially
    (function runNext(i) {
      if (i >= tasks.length) {
        // cleanup
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.send(results);
      }
      tasks[i]((err) => {
        if (err) console.error('Import row error:', err && err.message);
        runNext(i+1);
      });
    })(0);

  } catch (e) {
    try { fs.unlinkSync(filePath); } catch (er) {}
    console.error('Import error:', e && e.message);
    return res.status(500).send({ error: e.message || 'Import failed' });
  }
});

module.exports = router;
