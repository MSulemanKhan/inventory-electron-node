const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

// Get all brands
router.get("/", (req, res) => {
  db.all("SELECT * FROM brands ORDER BY name ASC", [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Get single brand
router.get("/:id", (req, res) => {
  db.get("SELECT * FROM brands WHERE id = ?", [req.params.id], (err, row) => {
    if (err) res.status(500).send(err);
    else if (!row) res.status(404).send({ error: "Brand not found" });
    else res.send(row);
  });
});

// Create brand
router.post("/", (req, res) => {
  const { name, description } = req.body;
  db.run("INSERT INTO brands(name, description) VALUES (?, ?)",
    [name, description],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID, message: "Brand created successfully" });
    });
});

// Update brand
router.put("/:id", (req, res) => {
  const { name, description } = req.body;
  db.run("UPDATE brands SET name = ?, description = ? WHERE id = ?",
    [name, description, req.params.id],
    function(err) {
      if (err) res.status(500).send(err);
      else if (this.changes === 0) res.status(404).send({ error: "Brand not found" });
      else res.send({ message: "Brand updated successfully" });
    });
});

// Delete brand
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM brands WHERE id = ?", [req.params.id], function(err) {
    if (err) res.status(500).send(err);
    else if (this.changes === 0) res.status(404).send({ error: "Brand not found" });
    else res.send({ message: "Brand deleted successfully" });
  });
});

module.exports = router;
