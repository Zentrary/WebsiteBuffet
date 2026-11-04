const fs = require('fs');
const path = require('path');
const { querySQL } = require('../config/db.sql');

const migrationFile = path.join(__dirname, 'migrations', 'appdb.sql');

async function runMigrations() {
  const sql = fs.readFileSync(migrationFile, 'utf8');
  console.log(`กำลังรันไฟล์ฐานข้อมูล: appdb.sql ...`);
  await querySQL(sql);
  console.log('รันไฟล์ฐานข้อมูล appdb.sql เสร็จสมบูรณ์');
  console.log('ฐานข้อมูล SQL พร้อมใช้งานแล้ว');
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('เกิดข้อผิดพลาดขณะรันไฟล์ฐานข้อมูล:', error);
      process.exit(1);
    });
}

module.exports = { runMigrations };
