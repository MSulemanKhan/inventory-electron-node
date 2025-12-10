const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

// Get all categories
router.get("/", (req, res) => {
  db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Get single category
router.get("/:id", (req, res) => {
  db.get("SELECT * FROM categories WHERE id = ?", [req.params.id], (err, row) => {
    if (err) res.status(500).send(err);
    else if (!row) res.status(404).send({ error: "Category not found" });
    else res.send(row);
  });
});

// Create category
router.post("/", (req, res) => {
  const { name, description } = req.body;
  db.run("INSERT INTO categories(name, description) VALUES (?, ?)",
    [name, description],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID, message: "Category created successfully" });
    });
});

// Update category
router.put("/:id", (req, res) => {
  const { name, description } = req.body;
  db.run("UPDATE categories SET name = ?, description = ? WHERE id = ?",
    [name, description, req.params.id],
    function(err) {
      if (err) res.status(500).send(err);
      else if (this.changes === 0) res.status(404).send({ error: "Category not found" });
      else res.send({ message: "Category updated successfully" });
    });
});

// Delete category
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM categories WHERE id = ?", [req.params.id], function(err) {
    if (err) res.status(500).send(err);
    else if (this.changes === 0) res.status(404).send({ error: "Category not found" });
    else res.send({ message: "Category deleted successfully" });
  });
});

module.exports = router;
