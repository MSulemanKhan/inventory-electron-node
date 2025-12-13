// Utility: list routes defined in orders router
const path = require('path');
const router = require(path.join(__dirname, '..', 'src', 'routes', 'orders.routes'));

function listRoutes(r) {
  const out = [];
  (r.stack || []).forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(',');
      out.push(`${methods} ${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      out.push(`Nested router: ${layer.regexp}`);
    }
  });
  return out;
}

const routes = listRoutes(router);
console.log('Orders routes:');
routes.forEach(r => console.log(' -', r));
