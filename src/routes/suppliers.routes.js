const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

// Get all suppliers
router.get("/", (req, res) => {
  db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
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

module.exports = router;
