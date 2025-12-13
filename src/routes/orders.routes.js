const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

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

module.exports = router;
