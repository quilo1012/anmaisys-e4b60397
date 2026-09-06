insert into public.sc_classification_rules
  (match_field, match_value, match_mode, line_name, priority, active)
values
  ('title', '(^|[^a-z0-9])6[ab]([^a-z0-9]|$)', 'regex', 'Line 6', 8, true),
  ('title', 'capsule ?2|caps ?2', 'regex', 'Capsules Machine 2', 8, true),
  ('title', '\(caps\)|\(capsule\)|capsule line', 'regex', 'Capsules Machine 1', 12, true);

insert into public.sc_classification_rules
  (match_field, match_value, match_mode, department, priority, active)
values
  ('title', 'k53', 'contains', 'Facilities', 15, true),
  ('title', 'warehouse', 'contains', 'Warehouse', 15, true),
  ('title', 'goods in|good in|supplier', 'regex', 'Goods In', 15, true),
  ('title', 'blender room|blue blender', 'regex', 'Blender Room', 15, true),
  ('template', 'forklift|ppt checklist', 'regex', 'Logistics', 18, true),
  ('template', 'emergency lighting', 'contains', 'Facilities', 18, true);

insert into public.sc_classification_rules
  (match_field, match_value, match_mode, category, error_type, priority, active)
values
  ('title', 'not recorded', 'contains', 'DOCUMENTATION', 'Check not recorded', 40, true),
  ('title', 'missing the last check|missing filling checks|missing fillers check|missing checks', 'regex', 'DOCUMENTATION', 'Missing check on spec', 40, true),
  ('title', 'missing informations on checklist|missing information on checklist', 'regex', 'DOCUMENTATION', 'Incomplete checklist', 40, true),
  ('title', 'missing finishing time|missing pallet out time|missing date on the signature|missing sign', 'regex', 'DOCUMENTATION', 'Missing signature or time', 40, true),
  ('title', 'incorrectly completed allergen', 'contains', 'DOCUMENTATION', 'Incorrect allergen information', 40, true),
  ('title', 'wrong batch code', 'contains', 'LABELS', 'Wrong batch code', 40, true),
  ('title', 'wrong stickers|wrong sticker', 'regex', 'LABELS', 'Wrong label', 40, true),
  ('title', 'discrepancy between the scoop|scoop size', 'regex', 'LABELS', 'Spec discrepancy', 40, true),
  ('title', 'metal found|piece of metal|on the magnet|on magnet', 'regex', 'FOREIGN BODY', 'Metal on magnet', 40, true),
  ('title', 'black residue|rust|corrosion|steel cable', 'regex', 'FOREIGN BODY', 'Contamination risk', 42, true),
  ('title', 'construction waste|wood waste', 'regex', 'HYGIENE', 'Waste not removed', 42, true),
  ('title', 'underweight|net weight|nominal weight|incorrect collagen bag weight', 'regex', 'WEIGHT', 'Weight out of specification', 40, true),
  ('title', 'wrong qty', 'contains', 'SUPPLIER', 'Wrong quantity delivered', 40, true),
  ('title', 'dirty|wet pallet|deep cleaning|moisture|pest control|loose curtain', 'regex', 'HYGIENE', 'GMP breach', 44, true),
  ('title', 'doors not locked', 'contains', 'EQUIPMENT', 'CCP equipment not secured', 40, true),
  ('title', 'leakage', 'contains', 'EQUIPMENT', 'Product leakage', 42, true),
  ('title', 'broken|isn''t working|not working|emergency light|flashing strobe|loose roof panel|repair ', 'regex', 'EQUIPMENT', 'Equipment defect', 46, true),
  ('title', 'toolbox|screwdriver|knife|metal cup', 'regex', 'TOOL CONTROL', 'Tool missing from control', 44, true),
  ('title', 'improperly stored', 'contains', 'STORAGE', 'Improper storage', 40, true),
  ('title', 'placed on hold|production hold|sample bags|in hold', 'regex', 'PRODUCT CONTROL', 'Product placed on hold', 46, true);