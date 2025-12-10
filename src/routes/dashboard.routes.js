const express = require("express");
const router = express.Router();
const db = require("../db/sqlite");

// Get dashboard statistics
router.get("/stats", (req, res) => {
  const stats = {};
  
  // Get total products
  db.get("SELECT COUNT(*) as count FROM products", [], (err, row) => {
    if (err) return res.status(500).send(err);
    stats.totalProducts = row.count;
    
    // Get total brands
    db.get("SELECT COUNT(*) as count FROM brands", [], (err, row) => {
      if (err) return res.status(500).send(err);
      stats.totalBrands = row.count;
      
      // Get total categories
      db.get("SELECT COUNT(*) as count FROM categories", [], (err, row) => {
        if (err) return res.status(500).send(err);
        stats.totalCategories = row.count;
        
        // Get total suppliers
        db.get("SELECT COUNT(*) as count FROM suppliers", [], (err, row) => {
          if (err) return res.status(500).send(err);
          stats.totalSuppliers = row.count;
          
          // Get low stock items
          db.get("SELECT COUNT(*) as count FROM products WHERE quantity <= reorder_level", [], (err, row) => {
            if (err) return res.status(500).send(err);
            stats.lowStockItems = row.count;
            
            // Get total inventory value
            db.get("SELECT SUM(quantity * price) as value FROM products", [], (err, row) => {
              if (err) return res.status(500).send(err);
              stats.totalInventoryValue = row.value || 0;
              
              res.send(stats);
            });
          });
        });
      });
    });
  });
});

module.exports = router;
