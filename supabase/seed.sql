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
