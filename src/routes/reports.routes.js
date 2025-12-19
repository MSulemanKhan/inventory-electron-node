const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const PDFDocument = require('pdfkit');

function writeHeader(doc, title) {
  const startX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // Header band
  doc.rect(startX, doc.y, pageWidth, 64).fill('#2c3e50');
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('Shah Traders', startX, doc.y + 16, { width: pageWidth, align: 'center' });
  doc.moveDown();
  doc.fillColor('#ffffff').fontSize(12).font('Helvetica').text(title, startX, doc.y - 28, { width: pageWidth, align: 'center' });
  doc.moveDown();
}

router.get('/inventory/pdf', (req, res) => {
  // generate inventory PDF
  db.all('SELECT * FROM products ORDER BY name', [], (err, rows) => {
    if (err) return res.status(500).send({ error: 'Failed to load products', details: err.message });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=inventory-report.pdf`);
    doc.pipe(res);

    writeHeader(doc, 'Inventory Report');

    doc.moveDown();
    // metrics
    const totalQty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    const totalValue = rows.reduce((s, r) => s + ((r.quantity || 0) * (r.price || 0)), 0);

    doc.fontSize(10).fillColor('#374151').font('Helvetica');
    doc.text(`Total Items: ${totalQty}`, { continued: true }).text(`   Stock Value: ${totalValue.toFixed(2)}`);
    doc.moveDown();

    // Table header (use explicit headerTop so subsequent row fills don't overlap)
    const startX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colName = startX;
    const colSku = startX + Math.round(pageWidth * 0.5);
    const colQty = startX + Math.round(pageWidth * 0.7);
    const colPrice = startX + Math.round(pageWidth * 0.82);

    // reserve a little extra space to avoid overlaps
    const headerTop = doc.y + 6;
    doc.rect(startX, headerTop, pageWidth, 22).fill('#2c3e50');
    // Draw each header with explicit font/color and width to avoid overlap or clipping
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
    doc.text('Product', colName + 6, headerTop + 6, { width: colSku - colName - 12, align: 'left' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
    doc.text('SKU', colSku + 6, headerTop + 6, { width: colQty - colSku - 12, align: 'left' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
    doc.text('Qty', colQty + 6, headerTop + 6, { width: colPrice - colQty - 12, align: 'left' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
    doc.text('Price', colPrice + 6, headerTop + 6, { width: startX + pageWidth - colPrice - 12, align: 'left' });

    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    // move current y past the header so subsequent draws start below it
    let y = headerTop + 22;
    doc.y = y;
    const rowH = 20;
    rows.forEach((p, idx) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) { doc.addPage(); y = doc.y; }
      if (idx % 2 === 0) doc.rect(startX, y, pageWidth, rowH).fill('#fbfdff');
      doc.fillColor('#111827').text(p.name || '', colName + 6, y + 6, { width: colSku - colName - 12 });
      doc.text(p.sku || '', colSku + 6, y + 6);
      doc.text(String(p.quantity || 0), colQty + 6, y + 6);
      doc.text(((p.price || 0).toFixed(2)), colPrice + 6, y + 6);
      y += rowH;
    });

    doc.end();
  });
});

router.get('/sales/pdf', (req, res) => {
  // Basic sales report (orders)
  db.all('SELECT * FROM orders ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).send({ error: 'Failed to load orders', details: err.message });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=sales-report.pdf`);
    doc.pipe(res);

    writeHeader(doc, 'Sales Report');
    doc.moveDown();

    const totalSales = rows.reduce((s, r) => s + (r.total || 0), 0);
    doc.fontSize(10).text(`Orders: ${rows.length}   Total Sales: ${totalSales.toFixed(2)}`);
    doc.moveDown();

    // table
    const startX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colId = startX;
    const colDate = startX + Math.round(pageWidth * 0.2);
    const colCustomer = startX + Math.round(pageWidth * 0.5);
    const colTotal = startX + Math.round(pageWidth * 0.8);

    doc.rect(startX, doc.y, pageWidth, 22).fill('#2c3e50');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
    doc.text('Order #', colId + 6, doc.y + 6);
    doc.text('Date', colDate + 6, doc.y + 6);
    doc.text('Customer', colCustomer + 6, doc.y + 6);
    doc.text('Total', colTotal + 6, doc.y + 6);

    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    let y = doc.y + 22;
    const rowH = 20;
    rows.forEach((o, idx) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) { doc.addPage(); y = doc.y; }
      if (idx % 2 === 0) doc.rect(startX, y, pageWidth, rowH).fill('#fbfdff');
      doc.fillColor('#111827').text(String(o.id), colId + 6, y + 6);
      doc.text(String(o.created_at || ''), colDate + 6, y + 6);
      doc.text(String(o.customer_name || ''), colCustomer + 6, y + 6, { width: colTotal - colCustomer - 12 });
      doc.text(((o.total || 0).toFixed(2)), colTotal + 6, y + 6);
      y += rowH;
    });

    doc.end();
  });
});

router.get('/suppliers/pdf', (req, res) => {
  db.all('SELECT s.*, COUNT(p.id) as product_count, SUM(p.quantity * p.price) as total_value FROM suppliers s LEFT JOIN products p ON p.supplier_id = s.id GROUP BY s.id', [], (err, rows) => {
    if (err) return res.status(500).send({ error: 'Failed to load suppliers', details: err.message });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=suppliers-report.pdf`);
    doc.pipe(res);

    writeHeader(doc, 'Suppliers Report');
    doc.moveDown();

    const startX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colName = startX;
    const colCount = startX + Math.round(pageWidth * 0.6);
    const colValue = startX + Math.round(pageWidth * 0.82);

    doc.rect(startX, doc.y, pageWidth, 22).fill('#2c3e50');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
    doc.text('Supplier', colName + 6, doc.y + 6);
    doc.text('Products', colCount + 6, doc.y + 6);
    doc.text('Stock Value', colValue + 6, doc.y + 6);

    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    let y = doc.y + 22;
    const rowH = 20;
    rows.forEach((s, idx) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 60) { doc.addPage(); y = doc.y; }
      if (idx % 2 === 0) doc.rect(startX, y, pageWidth, rowH).fill('#fbfdff');
      doc.fillColor('#111827').text(s.name || '', colName + 6, y + 6);
      doc.text(String(s.product_count || 0), colCount + 6, y + 6);
      doc.text(((s.total_value || 0) || 0).toFixed(2), colValue + 6, y + 6);
      y += rowH;
    });

    doc.end();
  });
});

module.exports = router;
