
-- Migration: Enhance machines, problem_descriptions, and profiles tables

-- Machines: add line, sector, code, status
ALTER TABLE public.machines ADD COLUMN line text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN sector text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN code text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN status text DEFAULT 'active';

-- Problem descriptions: add category, severity, description, active
ALTER TABLE public.problem_descriptions ADD COLUMN category text DEFAULT '';
ALTER TABLE public.problem_descriptions ADD COLUMN severity text DEFAULT 'medium';
ALTER TABLE public.problem_descriptions ADD COLUMN description text DEFAULT '';
ALTER TABLE public.problem_descriptions ADD COLUMN active boolean DEFAULT true;

-- Profiles: add last_seen_at for online tracking
ALTER TABLE public.profiles ADD COLUMN last_seen_at timestamptz;
