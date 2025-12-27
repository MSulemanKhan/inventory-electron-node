const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./inventory.db");

db.serialize(() => {
  // Brands table
  db.run(`CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Categories table
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Suppliers table
  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Products table with enhanced fields
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    description TEXT,
    quantity INTEGER DEFAULT 0,
    price REAL NOT NULL,
    discount REAL DEFAULT 0,
    cost REAL,
    brand_id INTEGER,
    category_id INTEGER,
    supplier_id INTEGER,
    reorder_level INTEGER DEFAULT 10,
    unit TEXT DEFAULT 'pcs',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  )`);

  // ensure discount column exists for existing DBs
  db.all(`PRAGMA table_info(products)`, [], (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasDiscount = cols.some(c => c.name === 'discount');
      if (!hasDiscount) {
        try {
          db.run(`ALTER TABLE products ADD COLUMN discount REAL DEFAULT 0`);
        } catch (e) {
          console.warn('Could not add discount column:', e && e.message);
        }
      }
    }
  });

  // Inventory transactions table
  db.run(`CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    notes TEXT,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Orders table
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    total REAL NOT NULL,
    tax REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Order items table
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0,
    total_price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // ensure discount column exists on order_items for existing DBs
  db.all(`PRAGMA table_info(order_items)`, [], (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasDiscount = cols.some(c => c.name === 'discount');
      if (!hasDiscount) {
        try {
          db.run(`ALTER TABLE order_items ADD COLUMN discount REAL DEFAULT 0`);
        } catch (e) {
          console.warn('Could not add discount column to order_items:', e && e.message);
        }
      }
    }
  });

  console.log("Database tables initialized successfully");
});

module.exports = db;
