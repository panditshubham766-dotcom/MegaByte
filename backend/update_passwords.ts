import pool from './src/config/db';
import bcrypt from 'bcryptjs';

async function updatePasswords() {
    try {
        console.log('Generating bcrypt hash for "password123"...');
        const hash = await bcrypt.hash('password123', 10);
        
        console.log('Updating all users in the database...');
        const result = await pool.query('UPDATE users SET password_hash = $1', [hash]);
        
        console.log(`Successfully updated ${result.rowCount} user(s).`);
    } catch (e) {
        console.error('Error updating passwords:', e);
    } finally {
        await pool.end();
    }
}

updatePasswords();
