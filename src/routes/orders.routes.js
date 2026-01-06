const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");
const PDFDocument = require('pdfkit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const upload = multer({ dest: path.join(__dirname, '../../uploads') });

function generateInvoicePdf(order, items, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.id}.pdf`);
  doc.pipe(res);

  // Constants / measurements
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  let y = doc.y;

  // Branded header band
  const headerHeight = 64;
  doc.rect(startX, y, pageWidth, headerHeight).fill('#2c3e50');
  doc.fillColor('#ffffff').fontSize(26).font('Helvetica-Bold').text('Shah Traders', startX, y + 14, { width: pageWidth, align: 'center' });
  doc.moveDown();
  y += headerHeight + 10;

  // Invoice meta (right-aligned)
  doc.fillColor('#374151').fontSize(10).font('Helvetica');
  const metaX = startX + pageWidth - 220;
  doc.text(`Invoice #: ${order.id}`, metaX, headerHeight + 56 - 20);
  doc.text(`Date: ${order.created_at}`, metaX, headerHeight + 56 - 6);
  doc.text(`Status: ${order.status || ''}`, metaX, headerHeight + 56 + 8);

  // Billing block
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#111827').text('Bill To', startX, y);
  doc.fontSize(10).font('Helvetica').fillColor('#374151');
  const billY = y + 16;
  doc.text(order.customer_name || '-', startX, billY);
  if (order.customer_phone) doc.text(order.customer_phone, startX, billY + 12);
  if (order.customer_address) doc.text(order.customer_address, startX, billY + 24);

  y = billY + 48;

  // Table header
  const colItem = startX + 0;
  const colQty = startX + Math.round(pageWidth * 0.6);
  const colUnit = startX + Math.round(pageWidth * 0.75);
  const colDiscount = startX + Math.round(pageWidth * 0.86);
  const colTotal = startX + Math.round(pageWidth * 0.94);

  // Header background
  doc.rect(startX, y, pageWidth, 28).fill('#2c3e50');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
  doc.text('Item', colItem + 6, y + 8, { width: colQty - colItem - 12 });
  doc.text('Qty', colQty + 6, y + 8);
  doc.text('Unit', colUnit + 6, y + 8);
  doc.text('Disc', colDiscount + 6, y + 8);
  doc.text('Total', colTotal + 6, y + 8);

  y += 28;

  // Items rows, striped
  let rowIndex = 0;
  let subtotal = 0;
  const rowHeight = 22;
  items.forEach((it) => {
    const rowTop = y + rowIndex * rowHeight;
    // stripe
    if (rowIndex % 2 === 0) {
      doc.rect(startX, rowTop, pageWidth, rowHeight).fill('#fbfdff');
    }
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    doc.text(it.product_name, colItem + 6, rowTop + 6, { width: colQty - colItem - 12 });
    doc.text((it.quantity || 0).toString(), colQty + 6, rowTop + 6);
    doc.text((it.unit_price || 0).toFixed(2), colUnit + 6, rowTop + 6);
    doc.text(((it.discount || 0)).toFixed(2), colDiscount + 6, rowTop + 6);
    doc.text((it.total_price || 0).toFixed(2), colTotal + 6, rowTop + 6);
    subtotal += (it.total_price || 0);
    rowIndex++;
    // check page break
    if (rowTop + rowHeight > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage();
      y = doc.y;
      rowIndex = 0;
    }
  });

  // Totals block
  const totalsTop = y + rowIndex * rowHeight + 12;
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`Subtotal:`, colDiscount, totalsTop, { width: 140, align: 'left' });
  doc.text(subtotal.toFixed(2), colTotal + 6, totalsTop, { align: 'right' });

  doc.text(`Discount:`, colDiscount, totalsTop + 16, { width: 140, align: 'left' });
  doc.text(((order.discount || 0)).toFixed(2), colTotal + 6, totalsTop + 16, { align: 'right' });

  doc.text(`Tax:`, colDiscount, totalsTop + 32, { width: 140, align: 'left' });
  doc.text(((order.tax || 0)).toFixed(2), colTotal + 6, totalsTop + 32, { align: 'right' });

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
  doc.text(`Total:`, colUnit, totalsTop + 56, { width: 140, align: 'left' });
  doc.text(((order.total || 0)).toFixed(2), colTotal + 6, totalsTop + 56, { align: 'right' });

  // Footer
  const footerY = doc.page.height - doc.page.margins.bottom - 40;
  doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('Thank you for your business.', startX, footerY, { width: pageWidth, align: 'center' });

  doc.end();
}

// Create order with items
router.post("/", (req, res) => {
  const { customer_name, customer_phone, customer_address, items, tax = 0, discount = 0 } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).send({ error: "Order must contain at least one item" });
  }

  // Insert order first (total will be finalized after items processed)
  const placeholderTotal = 0;
  const insertOrderQuery = `INSERT INTO orders(customer_name, customer_phone, customer_address, total, tax, discount) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(insertOrderQuery, [customer_name, customer_phone, customer_address, placeholderTotal, tax, discount], function(err) {
    if (err) return res.status(500).send(err);
    const orderId = this.lastID;

    // prepare item insert and process items sequentially so we can compute server-side pricing (considering product discount)
    const insertItem = db.prepare(`INSERT INTO order_items(order_id, product_id, product_name, quantity, unit_price, discount, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let subtotal = 0;

    const processNext = (idx) => {
      if (idx >= items.length) {
        insertItem.finalize((fErr) => {
          if (fErr) return res.status(500).send(fErr);
          const finalTotal = subtotal - (discount || 0) + (tax || 0);
          db.run('UPDATE orders SET total = ? WHERE id = ?', [finalTotal, orderId], (uErr) => {
            if (uErr) return res.status(500).send(uErr);
            res.send({ id: orderId, message: 'Order created successfully' });
          });
        });
        return;
      }

      const it = items[idx];
      const prodId = it.product_id || null;
      const qty = it.quantity || 0;

      if (prodId) {
        // fetch product to consider its discount when computing unit price
        db.get('SELECT price, discount, name FROM products WHERE id = ?', [prodId], (pErr, prod) => {
          if (pErr) {
            // skip this item on error
            return processNext(idx + 1);
          }
          const basePrice = (prod && prod.price) ? prod.price : 0;
          const prodDiscount = (prod && prod.discount) ? prod.discount : 0;
          const itemDiscount = (typeof it.discount === 'number') ? it.discount : prodDiscount;
          let unitPrice = (typeof it.unit_price === 'number' && it.unit_price > 0) ? it.unit_price : Math.max(0, basePrice - (itemDiscount || 0));
          unitPrice = Math.max(0, unitPrice);
          const totalPrice = qty * unitPrice;
          subtotal += totalPrice;
          const prodName = it.product_name || (prod && prod.name) || '';
          insertItem.run([orderId, prodId, prodName, qty, unitPrice, itemDiscount || 0, totalPrice], (iErr) => {
            if (iErr) console.error('Failed insert item', iErr);
            // decrement product stock
            db.run(`UPDATE products SET quantity = quantity - ? WHERE id = ?`, [qty, prodId], () => {
              processNext(idx + 1);
            });
          });
        });
      } else {
        const itemDiscount = (typeof it.discount === 'number') ? it.discount : 0;
        const basePrice = (typeof it.unit_price === 'number') ? it.unit_price : 0;
        const unitPrice = Math.max(0, basePrice - (itemDiscount || 0));
        const totalPrice = qty * unitPrice;
        subtotal += totalPrice;
        const prodName = it.product_name || it.name || '';
        insertItem.run([orderId, null, prodName, qty, unitPrice, itemDiscount || 0, totalPrice], (iErr) => {
          if (iErr) console.error('Failed insert item', iErr);
          processNext(idx + 1);
        });
      }
    };

    processNext(0);
  });
});

// Get all orders
router.get("/", (req, res) => {
  const q = `SELECT * FROM orders ORDER BY created_at DESC`;
  db.all(q, [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Export orders (with items as JSON string column)
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toString().toLowerCase();
  const q = `SELECT o.*, (SELECT json_group_array(json_object('product_id', oi.product_id, 'product_name', oi.product_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'discount', oi.discount, 'total_price', oi.total_price)) FROM order_items oi WHERE oi.order_id = o.id) as items_json FROM orders o ORDER BY o.created_at DESC`;
  db.all(q, [], (err, rows) => {
    if (err) return res.status(500).send(err);
    // parse items_json from null->''
    rows = rows.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [] }));
    if (format === 'xlsx') {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Orders');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="orders.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }
    const headers = Object.keys(rows[0] || { id: 'ID', customer_name: 'Customer', total: 'Total', created_at: 'Date', status: 'Status', items: 'Items' });
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = headers.map(h => {
        let v = r[h];
        if (h === 'items') v = JSON.stringify(r.items || []);
        if (v === null || v === undefined) v = '';
        if (typeof v === 'string' && v.includes(',')) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
      }).join(',');
      csvRows.push(line);
    }
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvRows.join('\n'));
  });
});

// Import orders (expect items column as JSON string or empty)
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
    const results = { created: 0, errors: 0 };
    const tasks = records.map(row => (done) => {
      const customer_name = row.customer_name || row.Customer || '';
      const customer_phone = row.customer_phone || row.Phone || '';
      const customer_address = row.customer_address || row.Address || '';
      const tax = Number(row.tax || 0) || 0;
      const discount = Number(row.discount || 0) || 0;
      let items = [];
      try { items = row.items ? (typeof row.items === 'string' ? JSON.parse(row.items) : row.items) : []; } catch (e) { items = []; }
      // insert order then items
      db.run('INSERT INTO orders(customer_name, customer_phone, customer_address, total, tax, discount) VALUES (?,?,?,?,?,?)', [customer_name, customer_phone, customer_address, 0, tax, discount], function(err) {
        if (err) { results.errors++; return done(err); }
        const orderId = this.lastID;
        const insertItem = db.prepare('INSERT INTO order_items(order_id, product_id, product_name, quantity, unit_price, discount, total_price) VALUES (?,?,?,?,?,?,?)');
        let subtotal = 0;
        const itTasks = (items || []).map(it => (nxt) => {
          const prodId = it.product_id || null;
          const qty = Number(it.quantity || 0) || 0;
          const unit_price = Number(it.unit_price || 0) || 0;
          const disc = Number(it.discount || 0) || 0;
          const total_price = Number(it.total_price || (qty * unit_price)) || 0;
          subtotal += total_price;
          insertItem.run([orderId, prodId, it.product_name || it.name || '', qty, unit_price, disc, total_price], () => nxt());
        });
        (function runI(i) {
          if (i >= itTasks.length) {
            insertItem.finalize(() => {
              // If items failed to parse or subtotal is zero but the row provides a total, prefer that total.
              let finalTotal = subtotal;
              if ((!finalTotal || finalTotal === 0) && row.total) {
                finalTotal = Number(row.total) || 0;
              }
              finalTotal = finalTotal - discount + tax;
              db.run('UPDATE orders SET total = ? WHERE id = ?', [finalTotal, orderId], (uErr) => {
                if (uErr) console.error('Failed finalize order', uErr);
                results.created++;
                return done(null);
              });
            });
            return;
          }
          itTasks[i](() => runI(i+1));
        })(0);
      });
    });
    (function runNext(i) { if (i >= tasks.length) { try { fs.unlinkSync(filePath); } catch (e) {} return res.send(results); } tasks[i]((err) => { if (err) console.error('Import order row error', err && err.message); runNext(i+1); }); })(0);
  } catch (e) { try { fs.unlinkSync(filePath); } catch (er) {} return res.status(500).send({ error: e.message || 'Import failed' }); }
});

// Delete all orders and order items
router.delete('/delete-all', (req, res) => {
  db.run('DELETE FROM order_items', [], function(err) {
    if (err) return res.status(500).send(err);
    db.run('DELETE FROM orders', [], function(err2) {
      if (err2) return res.status(500).send(err2);
      res.send({ message: 'All orders and items deleted' });
    });
  });
});

// Get order by id with items
router.get("/:id", (req, res) => {
  const orderId = req.params.id;
  db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send({ error: 'Order not found' });

    db.all(`SELECT * FROM order_items WHERE order_id = ?`, [orderId], (iErr, items) => {
      if (iErr) return res.status(500).send(iErr);
      order.items = items;
      res.send(order);
    });
  });
});

// Delete order (and its items)
router.delete('/:id', (req, res) => {
  const orderId = req.params.id;
  db.run('DELETE FROM order_items WHERE order_id = ?', [orderId], function(err) {
    if (err) return res.status(500).send(err);
    db.run('DELETE FROM orders WHERE id = ?', [orderId], function(err2) {
      if (err2) return res.status(500).send(err2);
      if (this.changes === 0) return res.status(404).send({ error: 'Order not found' });
      res.send({ message: 'Order deleted' });
    });
  });
});

// Cancel order: set status to 'canceled' and restore product quantities
router.post('/:id/cancel', (req, res) => {
  const orderId = req.params.id;
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send({ error: 'Order not found' });
    if (order.status === 'canceled') return res.status(400).send({ error: 'Order already canceled' });

    db.all('SELECT * FROM order_items WHERE order_id = ?', [orderId], (iErr, items) => {
      if (iErr) return res.status(500).send(iErr);

      const restoreNext = (idx) => {
        if (idx >= items.length) {
          db.run('UPDATE orders SET status = ? WHERE id = ?', ['canceled', orderId], function(uErr) {
            if (uErr) return res.status(500).send(uErr);
            return res.send({ message: 'Order canceled and stock restored' });
          });
          return;
        }
        const it = items[idx];
        if (it.product_id) {
          db.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [it.quantity, it.product_id], (pErr) => {
            if (pErr) console.error('Failed to restore product qty', pErr);
            restoreNext(idx + 1);
          });
        } else {
          restoreNext(idx + 1);
        }
      };

      restoreNext(0);
    });
  });
});

// Refund order: set status to 'refunded' and restore product quantities
router.post('/:id/refund', (req, res) => {
  const orderId = req.params.id;
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send({ error: 'Order not found' });
    if (order.status === 'refunded') return res.status(400).send({ error: 'Order already refunded' });

    db.all('SELECT * FROM order_items WHERE order_id = ?', [orderId], (iErr, items) => {
      if (iErr) return res.status(500).send(iErr);

      const restoreNext = (idx) => {
        if (idx >= items.length) {
          db.run('UPDATE orders SET status = ? WHERE id = ?', ['refunded', orderId], function(uErr) {
            if (uErr) return res.status(500).send(uErr);
            return res.send({ message: 'Order refunded and stock restored' });
          });
          return;
        }
        const it = items[idx];
        if (it.product_id) {
          db.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [it.quantity, it.product_id], (pErr) => {
            if (pErr) console.error('Failed to restore product qty', pErr);
            restoreNext(idx + 1);
          });
        } else {
          restoreNext(idx + 1);
        }
      };

      restoreNext(0);
    });
  });
});

// Generate PDF invoice for order
router.get('/:id/invoice/pdf', (req, res) => {
  const orderId = req.params.id;
  db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
    if (err) return res.status(500).send(err);
    if (!order) return res.status(404).send({ error: 'Order not found' });

    db.all(`SELECT * FROM order_items WHERE order_id = ?`, [orderId], (iErr, items) => {
      if (iErr) return res.status(500).send(iErr);
      // generate PDF and stream to response
      generateInvoicePdf(order, items, res);
    });
  });
});

module.exports = router;
