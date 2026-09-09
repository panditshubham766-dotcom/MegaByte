import pool from './src/config/db';

async function alterDb() {
    try {
        console.log('Adding photo_base64 to attendance_records...');
        await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS photo_base64 TEXT;');
        console.log('Done.');
    } catch (e) {
        console.error('DB Error:', e);
    } finally {
        await pool.end();
    }
}

alterDb();
