const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./inventory.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    quantity INTEGER,
    price REAL
  )`);
});

module.exports = db;
