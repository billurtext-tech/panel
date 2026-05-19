-- Umumiy ranglar (Speka zakazlar uchun)
INSERT INTO colors (code, name_uz, hex) VALUES
  ('BLACK',  'Qora',   '#1a1a1a'),
  ('WHITE',  'Oq',     '#ffffff'),
  ('NAVY',   'To''q ko''k', '#001f3f'),
  ('BLUE',   'Ko''k',  '#0077b6'),
  ('RED',    'Qizil',  '#c1121f'),
  ('GREY',   'Kulrang','#708090'),
  ('BEIGE',  'Bej',    '#d4b896'),
  ('GREEN',  'Yashil', '#2d6a4f')
ON CONFLICT (code) DO NOTHING;
