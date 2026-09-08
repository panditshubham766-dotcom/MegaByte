-- Seed 1 test Faculty account and 2 test Student accounts
INSERT INTO users (id, name, email, password_hash, role, student_id) VALUES
('f1000000-0000-0000-0000-000000000000', 'Dr. Alan Turing', 'alan.turing@university.edu', 'hashed_password_placeholder', 'FACULTY', NULL),
('51000000-0000-0000-0000-000000000000', 'Ada Lovelace', 'ada.lovelace@university.edu', 'hashed_password_placeholder', 'STUDENT', 'STU1001'),
('52000000-0000-0000-0000-000000000000', 'Grace Hopper', 'grace.hopper@university.edu', 'hashed_password_placeholder', 'STUDENT', 'STU1002');
