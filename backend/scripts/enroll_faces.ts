import fs from 'fs';
import path from 'path';
import pool from '../src/config/db';
import { getEmbedding } from '../src/services/face';

interface FileSummary {
  file: string;
  status: 'OK' | 'FAIL' | 'SKIP';
  studentId?: string;
  reason?: string;
}

interface StudentEnrollmentSummary {
  studentId: string;
  name: string;
  count: number;
}

async function enrollFaces() {
  const photosDir = path.resolve(__dirname, '../reference_photos');
  const fileSummaries: FileSummary[] = [];
  const studentSummaries: StudentEnrollmentSummary[] = [];

  console.log(`Scanning reference photos in: ${photosDir}`);

  if (!fs.existsSync(photosDir)) {
    console.error(`Directory not found: ${photosDir}`);
    await pool.end();
    return;
  }

  const entries = fs.readdirSync(photosDir);
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png']);

  const imageFiles = entries.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return imageExtensions.has(ext);
  });

  console.log(`Found ${imageFiles.length} image files to process.`);

  // Load all students
  const studentsRes = await pool.query(
    'SELECT id, name, student_id FROM users WHERE role = $1 AND student_id IS NOT NULL',
    ['STUDENT']
  );
  const studentsByUpperId = new Map<string, { id: string; name: string; student_id: string }>();
  for (const s of studentsRes.rows) {
    studentsByUpperId.set(s.student_id.toUpperCase(), s);
  }

  // Group files by student_id (<student_id>.<ext> or <student_id>_<anything>.<ext>)
  const studentFilesMap = new Map<string, string[]>();

  for (const file of imageFiles) {
    const baseName = path.parse(file).name;
    const underscoreIdx = baseName.indexOf('_');
    const candidateId = underscoreIdx !== -1 ? baseName.substring(0, underscoreIdx) : baseName;
    const student = studentsByUpperId.get(candidateId.toUpperCase());

    if (!student) {
      fileSummaries.push({
        file,
        status: 'SKIP',
        reason: `No student record found with student_id "${candidateId}"`
      });
      continue;
    }

    const key = student.student_id;
    if (!studentFilesMap.has(key)) {
      studentFilesMap.set(key, []);
    }
    studentFilesMap.get(key)!.push(file);
  }

  // For each student with files
  for (const [studentId, files] of studentFilesMap.entries()) {
    const student = studentsByUpperId.get(studentId.toUpperCase())!;
    let filesToProcess = files;

    if (files.length > 5) {
      console.warn(`[WARN] Student ${studentId} has ${files.length} reference photos. Maximum 5 allowed; extra ${files.length - 5} photo(s) ignored.`);
      for (let i = 5; i < files.length; i++) {
        console.warn(`[WARN] Extra photo ignored for ${studentId}: ${files[i]}`);
      }
      filesToProcess = files.slice(0, 5);
    }

    const embeddings: number[][] = [];

    for (const file of filesToProcess) {
      const filePath = path.join(photosDir, file);
      try {
        const imageBuffer = fs.readFileSync(filePath);
        const embedding = await getEmbedding(imageBuffer);
        embeddings.push(embedding);
        fileSummaries.push({
          file,
          status: 'OK',
          studentId: student.student_id,
          reason: `Computed face embedding`
        });
      } catch (err: any) {
        fileSummaries.push({
          file,
          status: 'FAIL',
          studentId: student.student_id,
          reason: err.message || String(err)
        });
      }
    }

    // REPLACE stored value with the full list of embeddings (no appending on re-run)
    if (embeddings.length > 0) {
      await pool.query(
        'UPDATE users SET face_embedding = $1, face_enrolled_at = NOW() WHERE id = $2',
        [JSON.stringify(embeddings), student.id]
      );
    }

    studentSummaries.push({
      studentId: student.student_id,
      name: student.name,
      count: embeddings.length
    });
  }

  console.log('\n--- File Processing Summary ---');
  for (const item of fileSummaries) {
    console.log(`[${item.status}] ${item.file}${item.studentId ? ` (${item.studentId})` : ''}: ${item.reason || ''}`);
  }

  console.log('\n--- Student Enrollment Summary ---');
  for (const item of studentSummaries) {
    console.log(`[ENROLLED] ${item.studentId} (${item.name}): ${item.count} embedding(s) stored`);
  }
  console.log('----------------------------------\n');

  await pool.end();
}

enrollFaces().catch(async (err) => {
  console.error('Fatal error during face enrollment:', err);
  await pool.end();
  process.exit(1);
});
