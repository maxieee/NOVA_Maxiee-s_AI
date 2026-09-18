-- Seed the fixed reminder-type taxonomy. Safe to re-run.
insert into reminder_types (key, label, icon, color) values
  ('task', 'Task', 'check-square', '#6366f1'),
  ('payment', 'Payment', 'credit-card', '#f59e0b'),
  ('call', 'Call', 'phone', '#22d3ee'),
  ('meeting', 'Meeting', 'users', '#8b5cf6'),
  ('follow_up', 'Follow-up', 'repeat', '#ec4899'),
  ('important_date', 'Important Date', 'star', '#f43f5e'),
  ('general', 'General Reminder', 'bell', '#8b93a3'),
  ('recurring', 'Recurring Reminder', 'refresh-cw', '#22c55e')
on conflict (key) do nothing;
