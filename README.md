# Inventory Management Backend

Node.js/Express backend with SQLite database for the Inventory Management System.

## Setup

```powershell
npm install
```

## Run

```powershell
npm start
```

Server will run on `http://localhost:3000`

## API Endpoints

### Products
- GET /api/products - Get all products
- GET /api/products/:id - Get single product
- POST /api/products - Create product
- PUT /api/products/:id - Update product
- DELETE /api/products/:id - Delete product
- GET /api/products/alerts/low-stock - Get low stock products

### Brands
- GET /api/brands
- POST /api/brands
- PUT /api/brands/:id
- DELETE /api/brands/:id

### Categories
- GET /api/categories
- POST /api/categories
- PUT /api/categories/:id
- DELETE /api/categories/:id

### Suppliers
- GET /api/suppliers
- POST /api/suppliers
- PUT /api/suppliers/:id
- DELETE /api/suppliers/:id

### Dashboard
- GET /api/dashboard/stats - Get statistics

## Database

SQLite database is automatically created as `inventory.db` in the root directory.
