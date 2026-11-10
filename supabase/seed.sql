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
