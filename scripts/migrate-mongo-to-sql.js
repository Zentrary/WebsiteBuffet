require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { connectSQL, closeSQL } = require('../config/db.sql');
const { migrateMongoToSql } = require('../services/mongoToSqlMigration');

async function main() {
  try {
    await connectDB();
    await connectSQL();
    const result = await migrateMongoToSql({ force: true });
    console.log('Migration complete:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    await closeSQL().catch(() => {});
  }
}

main();
