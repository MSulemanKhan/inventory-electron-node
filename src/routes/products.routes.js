const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

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
  const { name, sku, description, quantity, price, cost, brand_id, category_id, supplier_id, reorder_level, unit } = req.body;
  const query = `INSERT INTO products(name, sku, description, quantity, price, cost, brand_id, category_id, supplier_id, reorder_level, unit) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [name, sku, description, quantity || 0, price, cost, brand_id, category_id, supplier_id, reorder_level || 10, unit || 'pcs'],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID, message: "Product created successfully" });
    });
});

// Update product
router.put("/:id", (req, res) => {
  const { name, sku, description, quantity, price, cost, brand_id, category_id, supplier_id, reorder_level, unit } = req.body;
  const query = `UPDATE products 
                 SET name = ?, sku = ?, description = ?, quantity = ?, price = ?, cost = ?, 
                     brand_id = ?, category_id = ?, supplier_id = ?, reorder_level = ?, unit = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`;
  
  db.run(query, [name, sku, description, quantity, price, cost, brand_id, category_id, supplier_id, reorder_level, unit, req.params.id],
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

module.exports = router;
