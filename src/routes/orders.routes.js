const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");
const PDFDocument = require('pdfkit');

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
  const colQty = startX + Math.round(pageWidth * 0.65);
  const colUnit = startX + Math.round(pageWidth * 0.78);
  const colTotal = startX + Math.round(pageWidth * 0.88);

  // Header background
  doc.rect(startX, y, pageWidth, 28).fill('#2c3e50');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
  doc.text('Item', colItem + 6, y + 8, { width: colQty - colItem - 12 });
  doc.text('Qty', colQty + 6, y + 8);
  doc.text('Unit', colUnit + 6, y + 8);
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
  doc.text(`Subtotal:`, colUnit, totalsTop, { width: 140, align: 'left' });
  doc.text(subtotal.toFixed(2), colTotal + 6, totalsTop, { align: 'right' });

  doc.text(`Discount:`, colUnit, totalsTop + 16, { width: 140, align: 'left' });
  doc.text(((order.discount || 0)).toFixed(2), colTotal + 6, totalsTop + 16, { align: 'right' });

  doc.text(`Tax:`, colUnit, totalsTop + 32, { width: 140, align: 'left' });
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

  // compute totals
  let subtotal = 0;
  items.forEach(it => {
    subtotal += (it.quantity || 0) * (it.unit_price || 0);
  });
  const total = subtotal - (discount || 0) + (tax || 0);

  const insertOrderQuery = `INSERT INTO orders(customer_name, customer_phone, customer_address, total, tax, discount) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(insertOrderQuery, [customer_name, customer_phone, customer_address, total, tax, discount], function(err) {
    if (err) return res.status(500).send(err);
    const orderId = this.lastID;

    // insert items sequentially
    const insertItem = db.prepare(`INSERT INTO order_items(order_id, product_id, product_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)`);

    items.forEach((it) => {
      const prodId = it.product_id || null;
      const prodName = it.product_name || it.name || '';
      const qty = it.quantity || 0;
      const unitPrice = it.unit_price || 0;
      const totalPrice = qty * unitPrice;
      insertItem.run([orderId, prodId, prodName, qty, unitPrice, totalPrice]);

      // decrement product stock if product_id provided
      if (prodId) {
        db.run(`UPDATE products SET quantity = quantity - ? WHERE id = ?`, [qty, prodId]);
      }
    });

    insertItem.finalize((fErr) => {
      if (fErr) return res.status(500).send(fErr);
      res.send({ id: orderId, message: 'Order created successfully' });
    });
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
