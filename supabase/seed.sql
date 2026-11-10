-- Demo colleges and departments. No fake students.
insert into public.colleges (id, name, email_domain) values
  ('00000000-0000-0000-0000-00000000a001', 'Demo Institute of Technology', 'demo-iot.edu'),
  ('00000000-0000-0000-0000-00000000b001', 'Demo College of Arts', 'demo-arts.edu')
on conflict do nothing;

insert into public.departments (college_id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'Computer Science'),
  ('00000000-0000-0000-0000-00000000a001', 'Mechanical Engineering'),
  ('00000000-0000-0000-0000-00000000b001', 'Literature'),
  ('00000000-0000-0000-0000-00000000b001', 'Fine Arts');

insert into public.subjects (college_id, code, name, credits) values
  ('00000000-0000-0000-0000-00000000a001', 'CS301', 'DBMS', 4),
  ('00000000-0000-0000-0000-00000000a001', 'CS302', 'Operating Systems', 4),
  ('00000000-0000-0000-0000-00000000a001', 'CS303', 'Computer Networks', 3),
  ('00000000-0000-0000-0000-00000000a001', 'CS304', 'Theory of Computation', 3),
  ('00000000-0000-0000-0000-00000000a001', 'CS305', 'Software Engineering', 3),
  ('00000000-0000-0000-0000-00000000a001', 'MA301', 'Probability and Statistics', 3),
  ('00000000-0000-0000-0000-00000000a001', 'CS201', 'Data Structures', 4),
  ('00000000-0000-0000-0000-00000000a001', 'CS202', 'Discrete Mathematics', 3)
on conflict do nothing;

insert into public.departments (college_id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'Hostel'),
  ('00000000-0000-0000-0000-00000000a001', 'Maintenance'),
  ('00000000-0000-0000-0000-00000000a001', 'IT Services');

insert into public.locations (college_id, name) values
  ('00000000-0000-0000-0000-00000000a001', 'Hostel Block A'),
  ('00000000-0000-0000-0000-00000000a001', 'Hostel Block B'),
  ('00000000-0000-0000-0000-00000000a001', 'Library'),
  ('00000000-0000-0000-0000-00000000a001', 'Main Building'),
  ('00000000-0000-0000-0000-00000000a001', 'Cafeteria'),
  ('00000000-0000-0000-0000-00000000a001', 'Sports Complex'),
  ('00000000-0000-0000-0000-00000000b001', 'Arts Block')
on conflict do nothing;

-- Demo mentor. Created the way sign-up creates users: an auth.users row with a
-- confirmed email, so handle_new_user makes the profile. No password is set, so
-- nobody can sign in as this account.
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a9',
  'authenticated', 'authenticated', 'priya.sharma@demo-iot.edu', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Sharma"}',
  now(), now(), '', '', '', ''
) on conflict do nothing;

update public.profiles
set bio = 'Third-year Computer Science student. Happy to help with databases and systems.',
    skills = array['DBMS', 'SQL', 'Operating Systems'],
    is_mentor = true,
    department_id = (select id from public.departments
                     where college_id = '00000000-0000-0000-0000-00000000a001'
                       and name = 'Computer Science')
where id = '00000000-0000-0000-0000-0000000000a9';

-- Demo listing, sold by the seeded student above. No photo.
insert into public.listings (id, college_id, seller_id, title, description, price_inr, condition)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-0000000000a9',
  'Database System Concepts (Korth), used',
  'Sixth edition of the DBMS textbook by Korth, Silberschatz and Sudarshan. Some highlighting in the first chapters, no torn pages.',
  450, 'good'
) on conflict do nothing;
