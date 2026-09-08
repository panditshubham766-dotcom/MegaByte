import pool from './src/config/db';
import fs from 'fs';
import path from 'path';

async function testDb() {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('DB Connected:', res.rows[0]);
        
        // Load schema and seed
        const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf-8');
        const seed = fs.readFileSync(path.join(__dirname, '../database/seed.sql'), 'utf-8');
        
        console.log('Running schema...');
        await pool.query(schema);
        
        console.log('Running seed...');
        // Only run seed if users table is empty to avoid duplicate key errors
        const users = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(users.rows[0].count) === 0) {
            await pool.query(seed);
            console.log('Seed completed');
        } else {
            console.log('Users already exist, skipping seed');
        }
    } catch (e) {
        console.error('DB Error:', e);
    } finally {
        await pool.end();
    }
}

testDb();
