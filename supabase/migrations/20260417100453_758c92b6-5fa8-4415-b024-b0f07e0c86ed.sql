-- Add 'viewer' to existing app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';

-- Add ui_preferences column to profiles for sidebar mode persistence
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;