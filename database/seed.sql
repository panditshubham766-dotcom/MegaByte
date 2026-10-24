-- Seed class and subject taught by Dr. Alan Turing
INSERT INTO classes (id, name, department, semester, section) VALUES
('177df88c-3920-4e77-9086-c00be672a2b5', 'Computer Science 1st Year', 'Computer Science', 1, 'A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subjects (id, name, code, faculty_id) VALUES
('046ca2a0-1530-4ec5-8837-083b32f2f9f8', 'Introduction to Computer Science', 'CS101', 'f1000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Enrollments for both seeded students
INSERT INTO enrollments (id, student_id, subject_id, class_id) VALUES
('e1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000000', '046ca2a0-1530-4ec5-8837-083b32f2f9f8', '177df88c-3920-4e77-9086-c00be672a2b5'),
('e1000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000000', '046ca2a0-1530-4ec5-8837-083b32f2f9f8', '177df88c-3920-4e77-9086-c00be672a2b5')
ON CONFLICT (student_id, subject_id, class_id) DO NOTHING;
