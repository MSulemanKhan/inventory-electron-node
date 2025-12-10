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

app.use("/api/products", productsRoutes);
app.use("/api/brands", brandsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Health check
app.get("/api/ping", (req, res) => {
  res.send({ status: "Backend running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inventory Backend running on port ${PORT}`));
