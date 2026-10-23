import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pool from '../config/db';

let supabase: SupabaseClient | null = null;
const supabaseUrl = process.env.SUPABASE_URL || 'https://ldjyznaznwdkzxavjpxr.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
    } catch (e) {
        console.error('Failed to initialize Supabase client:', e);
    }
}

/**
 * Uploads a subject sheet to Supabase Storage bucket 'subject-sheets'
 * and syncs with database fallback table.
 */
export async function uploadSubjectSheet(
    filePath: string,
    buffer: Buffer | any,
    subjectId: string,
    facultyId: string
): Promise<void> {
    if (supabase) {
        try {
            const { error } = await supabase.storage
                .from('subject-sheets')
                .upload(filePath, buffer, {
                    upsert: true,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
            if (error) {
                console.error(`Supabase storage upload error for ${filePath}:`, error.message);
            }
        } catch (err) {
            console.error(`Supabase storage upload exception for ${filePath}:`, err);
        }
    }

    try {
        await pool.query(
            `INSERT INTO subject_sheet_files (subject_id, faculty_id, file, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (subject_id)
             DO UPDATE SET faculty_id = EXCLUDED.faculty_id, file = EXCLUDED.file, updated_at = NOW()`,
            [subjectId, facultyId, buffer]
        );
    } catch (dbErr) {
        console.error('Error storing fallback subject sheet file:', dbErr);
    }
}

/**
 * Downloads a subject sheet from Supabase Storage bucket 'subject-sheets',
 * falling back to database table if needed.
 */
export async function downloadSubjectSheet(
    filePath: string,
    subjectId: string
): Promise<Buffer | null> {
    if (supabase) {
        try {
            const { data, error } = await supabase.storage
                .from('subject-sheets')
                .download(filePath);
            if (!error && data) {
                const arrayBuf = await data.arrayBuffer();
                return Buffer.from(arrayBuf);
            }
            if (error) {
                console.warn(`Supabase storage download notice for ${filePath}:`, error.message);
            }
        } catch (err) {
            console.warn(`Supabase storage download exception for ${filePath}:`, err);
        }
    }

    try {
        const res = await pool.query(
            `SELECT file FROM subject_sheet_files WHERE subject_id = $1`,
            [subjectId]
        );
        if (res.rowCount && res.rowCount > 0) {
            return res.rows[0].file;
        }
    } catch (dbErr) {
        console.error('Error fetching fallback subject sheet file:', dbErr);
    }

    return null;
}
