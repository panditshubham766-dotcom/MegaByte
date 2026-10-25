import type { Pool } from 'pg';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: npx ts-node scripts/create_demo_faculty.ts <password>');
  process.exit(1);
}

// Suppress extraneous DB connecting logs so only the required output is printed
const originalLog = console.log;
console.log = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('DB connecting...')) {
    return;
  }
  originalLog(...args);
};

// Load pool and DATABASE_URL via src/config/db after argument check
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pool: Pool = require('../src/config/db').default;

async function main() {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Upsert user: name "Demo Faculty", email demo.faculty@iiitdwd.ac.in, role FACULTY, student_id NULL
    const userRes = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      ['demo.faculty@iiitdwd.ac.in']
    );

    let userId: string;
    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
      await client.query(
        `UPDATE users
         SET name = $1, password_hash = $2, role = 'FACULTY', student_id = NULL, updated_at = NOW()
         WHERE id = $3`,
        ['Demo Faculty', hash, userId]
      );
    } else {
      const insertUserRes = await client.query(
        `INSERT INTO users (name, email, password_hash, role, student_id)
         VALUES ($1, $2, $3, 'FACULTY', NULL)
         RETURNING id`,
        ['Demo Faculty', 'demo.faculty@iiitdwd.ac.in', hash]
      );
      userId = insertUserRes.rows[0].id;
    }

    // 2. Upsert subject owned by that user: code DEMO101, name "Demo Subject"
    const subRes = await client.query(
      'SELECT id FROM subjects WHERE UPPER(code) = UPPER($1)',
      ['DEMO101']
    );

    if (subRes.rows.length > 0) {
      await client.query(
        `UPDATE subjects
         SET name = $1, faculty_id = $2
         WHERE id = $3`,
        ['Demo Subject', userId, subRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO subjects (name, code, faculty_id)
         VALUES ($1, $2, $3)`,
        ['Demo Subject', 'DEMO101', userId]
      );
    }

    await client.query('COMMIT');
    originalLog('Demo faculty ready: demo.faculty@iiitdwd.ac.in, subject DEMO101');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => {
  console.error('Failed to create demo faculty');
  process.exit(1);
});
