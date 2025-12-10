const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

// Get all products
router.get("/", (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) res.status(500).send(err);
    else res.send(rows);
  });
});

// Add product
router.post("/", (req, res) => {
  const { name, quantity, price } = req.body;
  db.run("INSERT INTO products(name, quantity, price) VALUES (?, ?, ?)",
    [name, quantity, price],
    function(err) {
      if (err) res.status(500).send(err);
      else res.send({ id: this.lastID });
    });
});

module.exports = router;
