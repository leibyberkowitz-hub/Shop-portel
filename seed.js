// Seeds the product catalog with common fish-shop items (skips any that
// already exist). Run once with: npm run seed
const { db } = require('./src/db');

const PRODUCTS = [
  { name: 'Salmon fillet', unit: 'lb', price: 14.99 },
  { name: 'Whole salmon', unit: 'lb', price: 10.99 },
  { name: 'Tilapia fillet', unit: 'lb', price: 8.99 },
  { name: 'Flounder fillet', unit: 'lb', price: 12.99 },
  { name: 'Whitefish', unit: 'lb', price: 9.99 },
  { name: 'Whole carp', unit: 'lb', price: 6.99 },
  { name: 'Ground fish mix (gefilte)', unit: 'lb', price: 7.99 },
  { name: 'Gefilte fish loaf', unit: 'each', price: 11.99 },
  { name: 'Herring (pickled)', unit: 'each', price: 6.49 },
  { name: 'Branzino', unit: 'lb', price: 13.99 },
  { name: 'Red snapper', unit: 'lb', price: 15.99 },
  { name: 'Tuna steak', unit: 'lb', price: 17.99 },
];

const existing = db.prepare('SELECT name FROM products').all().map((p) => p.name);
const insert = db.prepare('INSERT INTO products (name, unit, price) VALUES (?, ?, ?)');
let added = 0;
for (const p of PRODUCTS) {
  if (!existing.includes(p.name)) {
    insert.run(p.name, p.unit, p.price);
    added++;
  }
}
console.log(`Seeded ${added} products (${existing.length} already existed).`);
