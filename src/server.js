const express = require("express");
const cors = require("cors");
const app = express();

// Initialize database
require("./db/sqlite");

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const productsRoutes = require("./routes/products.routes");
const brandsRoutes = require("./routes/brands.routes");
const categoriesRoutes = require("./routes/categories.routes");
const suppliersRoutes = require("./routes/suppliers.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const ordersRoutes = require("./routes/orders.routes");
const backupRoutes = require("./routes/backup.routes");
const reportsRoutes = require("./routes/reports.routes");

app.use("/api/products", productsRoutes);
app.use("/api/brands", brandsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/reports", reportsRoutes);

// Health check
app.get("/api/ping", (req, res) => {
  res.send({ status: "Backend running" });
});

const PORT = process.env.PORT || 3000;
// Diagnostic: list registered routes (simple walker)
function listRoutes() {
  const routes = [];
  app._router.stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      routes.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // nested router
      layer.handle.stack.forEach((l) => {
        if (l.route && l.route.path) {
          routes.push({ path: l.route.path, methods: Object.keys(l.route.methods) });
        }
      });
    }
  });
  return routes;
}

app.get('/api/_routes', (req, res) => {
  res.send(listRoutes());
});

app.listen(PORT, () => {
  console.log(`Inventory Backend running on port ${PORT}`);
  try { console.log('Registered routes:', JSON.stringify(listRoutes(), null, 2)); } catch (e) {}
});
