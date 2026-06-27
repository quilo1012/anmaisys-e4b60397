-- Consolidated missing schema for AN Maintenance production/RAG/planner modules
-- Generated from a full .from()/.rpc() audit across src/ and supabase/functions/.
-- Idempotent: creates missing tables and adds missing columns without dropping data.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public."app_role" AS ENUM ('admin', 'engineer', 'operator', 'manager', 'viewer', 'maintenance_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."machine_category" AS ENUM ('line_fixed', 'line_mobile', 'support');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."mobile_asset_type" AS ENUM ('printer', 'bag_sealer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."po_status" AS ENUM ('draft', 'sent', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public."wo_status" AS ENUM ('open', 'in_progress', 'completed', 'force_closed', 'received', 'arrived', 'finished', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public."profiles" (
  "id" uuid NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "shift" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone,
  "labor_rate" numeric DEFAULT 0 NOT NULL,
  "ui_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "production_line" text,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."profiles" TO authenticated;
GRANT ALL ON public."profiles" TO service_role;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "labor_rate" numeric DEFAULT 0;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "ui_preferences" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public."profiles" ADD COLUMN IF NOT EXISTS "production_line" text;

CREATE TABLE IF NOT EXISTS public."user_roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "role" public."app_role" NOT NULL,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY (id),
  CONSTRAINT "user_roles_user_id_unique" UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user_roles" TO authenticated;
GRANT ALL ON public."user_roles" TO service_role;
ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_roles" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."user_roles" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."user_roles" ADD COLUMN IF NOT EXISTS "role" public."app_role";

CREATE TABLE IF NOT EXISTS public."system_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "admin_pin" text DEFAULT extensions.crypt('1234'::text, extensions.gen_salt('bf'::text)) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "intouch_sync_enabled" boolean DEFAULT true NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."system_settings" TO authenticated;
GRANT ALL ON public."system_settings" TO service_role;
ALTER TABLE public."system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."system_settings" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."system_settings" ADD COLUMN IF NOT EXISTS "admin_pin" text DEFAULT extensions.crypt('1234'::text, extensions.gen_salt('bf'::text));
ALTER TABLE public."system_settings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."system_settings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."system_settings" ADD COLUMN IF NOT EXISTS "intouch_sync_enabled" boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public."product_categories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_categories_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_categories_name_key" UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."product_categories" TO authenticated;
GRANT ALL ON public."product_categories" TO service_role;
ALTER TABLE public."product_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_categories" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."product_categories" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."product_categories" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."products" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "min_stock" integer DEFAULT 0 NOT NULL,
  "category" text DEFAULT 'spare'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "line" text DEFAULT ''::text NOT NULL,
  "price" numeric DEFAULT 0 NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY (id),
  CONSTRAINT "products_code_key" UNIQUE (code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."products" TO authenticated;
GRANT ALL ON public."products" TO service_role;
ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 0;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "min_stock" integer DEFAULT 0;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'spare'::text;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "line" text DEFAULT ''::text;
ALTER TABLE public."products" ADD COLUMN IF NOT EXISTS "price" numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS public."suppliers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "contact_name" text,
  "email" text,
  "phone" text,
  "notes" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."suppliers" TO authenticated;
GRANT ALL ON public."suppliers" TO service_role;
ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "contact_name" text;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."suppliers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."purchase_orders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid,
  "status" public."po_status" DEFAULT 'draft'::po_status NOT NULL,
  "notes" text,
  "created_by" uuid,
  "sent_at" timestamp with time zone,
  "received_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."purchase_orders" TO authenticated;
GRANT ALL ON public."purchase_orders" TO service_role;
ALTER TABLE public."purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "supplier_id" uuid;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "status" public."po_status" DEFAULT 'draft'::po_status;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "received_at" timestamp with time zone;
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."purchase_orders" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."purchase_order_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "product_id" uuid,
  "product_name" text NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "purchase_order_items_quantity_check" CHECK ((quantity > 0))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."purchase_order_items" TO authenticated;
GRANT ALL ON public."purchase_order_items" TO service_role;
ALTER TABLE public."purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "purchase_order_id" uuid;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "product_id" uuid;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "product_name" text;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "quantity" integer;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "unit_price" numeric(12,2) DEFAULT 0;
ALTER TABLE public."purchase_order_items" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."lines" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "has_sides" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "lines_pkey" PRIMARY KEY (id),
  CONSTRAINT "lines_name_key" UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."lines" TO authenticated;
GRANT ALL ON public."lines" TO service_role;
ALTER TABLE public."lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "has_sides" boolean DEFAULT false;
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0;
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."lines" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public."line_leaders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "shift" text NOT NULL,
  "line" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "line_leaders_pkey" PRIMARY KEY (id),
  CONSTRAINT "line_leaders_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text, 'BOTH'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."line_leaders" TO authenticated;
GRANT ALL ON public."line_leaders" TO service_role;
ALTER TABLE public."line_leaders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."line_leaders" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."machines" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "line" text DEFAULT ''::text,
  "sector" text DEFAULT ''::text,
  "code" text DEFAULT ''::text,
  "status" text DEFAULT 'active'::text,
  "health_score" integer DEFAULT 100 NOT NULL,
  "machine_type" text DEFAULT ''::text NOT NULL,
  "current_location" text DEFAULT ''::text NOT NULL,
  "last_maintenance_date" timestamp with time zone,
  "side" text DEFAULT 'common'::text NOT NULL,
  "line_id" uuid,
  "category" public."machine_category",
  "fixed_line" text,
  "current_line" text,
  CONSTRAINT "machines_pkey" PRIMARY KEY (id),
  CONSTRAINT "machines_name_key" UNIQUE (name),
  CONSTRAINT "machines_side_check" CHECK ((side = ANY (ARRAY['A'::text, 'B'::text, 'common'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."machines" TO authenticated;
GRANT ALL ON public."machines" TO service_role;
ALTER TABLE public."machines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "line" text DEFAULT ''::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "sector" text DEFAULT ''::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "code" text DEFAULT ''::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active'::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "health_score" integer DEFAULT 100;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "machine_type" text DEFAULT ''::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "current_location" text DEFAULT ''::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "last_maintenance_date" timestamp with time zone;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "side" text DEFAULT 'common'::text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "category" public."machine_category";
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "fixed_line" text;
ALTER TABLE public."machines" ADD COLUMN IF NOT EXISTS "current_line" text;

CREATE TABLE IF NOT EXISTS public."mobile_assets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "asset_type" public."mobile_asset_type" NOT NULL,
  "asset_number" integer NOT NULL,
  "current_line_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mobile_assets_pkey" PRIMARY KEY (id),
  CONSTRAINT "mobile_assets_asset_type_asset_number_key" UNIQUE (asset_type, asset_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."mobile_assets" TO authenticated;
GRANT ALL ON public."mobile_assets" TO service_role;
ALTER TABLE public."mobile_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "asset_type" public."mobile_asset_type";
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "asset_number" integer;
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "current_line_id" uuid;
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."mobile_assets" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."engineers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "pin_hash" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "engineers_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."engineers" TO authenticated;
GRANT ALL ON public."engineers" TO service_role;
ALTER TABLE public."engineers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."engineers" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."engineers" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."engineers" ADD COLUMN IF NOT EXISTS "pin_hash" text;
ALTER TABLE public."engineers" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;
ALTER TABLE public."engineers" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."engineer_scores" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "engineer_id" uuid NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "engineer_scores_pkey" PRIMARY KEY (id),
  CONSTRAINT "engineer_scores_engineer_id_key" UNIQUE (engineer_id),
  CONSTRAINT "engineer_scores_score_range" CHECK (((score >= 0) AND (score <= 100)))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."engineer_scores" TO authenticated;
GRANT ALL ON public."engineer_scores" TO service_role;
ALTER TABLE public."engineer_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."engineer_scores" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."engineer_scores" ADD COLUMN IF NOT EXISTS "engineer_id" uuid;
ALTER TABLE public."engineer_scores" ADD COLUMN IF NOT EXISTS "score" integer DEFAULT 0;
ALTER TABLE public."engineer_scores" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."operator_line_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "label" text NOT NULL,
  "line_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "operator_line_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "operator_line_accounts_email_key" UNIQUE (email),
  CONSTRAINT "operator_line_accounts_user_id_key" UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."operator_line_accounts" TO authenticated;
GRANT ALL ON public."operator_line_accounts" TO service_role;
ALTER TABLE public."operator_line_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "line_ids" uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."operator_line_accounts" ADD COLUMN IF NOT EXISTS "created_by" uuid;

CREATE TABLE IF NOT EXISTS public."devices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "device_token" text NOT NULL,
  "line_id" uuid,
  "label" text,
  "paired_by" uuid,
  "paired_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY (id),
  CONSTRAINT "devices_device_token_key" UNIQUE (device_token)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."devices" TO authenticated;
GRANT ALL ON public."devices" TO service_role;
ALTER TABLE public."devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "device_token" text;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "paired_by" uuid;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "paired_at" timestamp with time zone;
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."devices" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."device_lines" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "line_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_lines_pkey" PRIMARY KEY (id),
  CONSTRAINT "device_lines_device_id_line_id_key" UNIQUE (device_id, line_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."device_lines" TO authenticated;
GRANT ALL ON public."device_lines" TO service_role;
ALTER TABLE public."device_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."device_lines" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."device_lines" ADD COLUMN IF NOT EXISTS "device_id" uuid;
ALTER TABLE public."device_lines" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."device_lines" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."pin_attempts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "lockout_step" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "last_attempt" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pin_attempts_pkey" PRIMARY KEY (id),
  CONSTRAINT "pin_attempts_user_id_key" UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."pin_attempts" TO authenticated;
GRANT ALL ON public."pin_attempts" TO service_role;
ALTER TABLE public."pin_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "failures" integer DEFAULT 0;
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "lockout_step" integer DEFAULT 0;
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "last_attempt" timestamp with time zone DEFAULT now();
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."pin_attempts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "wo_id" uuid,
  "title" text NOT NULL,
  "body" text DEFAULT ''::text NOT NULL,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "action_url" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."notifications" TO authenticated;
GRANT ALL ON public."notifications" TO service_role;
ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "wo_id" uuid;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "body" text DEFAULT ''::text;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium'::text;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "action_url" text;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;
ALTER TABLE public."notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."push_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE (user_id, endpoint)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."push_subscriptions" TO authenticated;
GRANT ALL ON public."push_subscriptions" TO service_role;
ALTER TABLE public."push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "endpoint" text;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "p256dh" text;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "auth" text;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "user_agent" text;
ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."problem_descriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "category" text DEFAULT ''::text,
  "severity" text DEFAULT 'medium'::text,
  "description" text DEFAULT ''::text,
  "active" boolean DEFAULT true,
  CONSTRAINT "problem_descriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "problem_descriptions_name_key" UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."problem_descriptions" TO authenticated;
GRANT ALL ON public."problem_descriptions" TO service_role;
ALTER TABLE public."problem_descriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "category" text DEFAULT ''::text;
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'medium'::text;
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "description" text DEFAULT ''::text;
ALTER TABLE public."problem_descriptions" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public."line_problem_descriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "line_id" uuid NOT NULL,
  "problem_description_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "line_problem_descriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "line_problem_descriptions_line_id_problem_description_id_key" UNIQUE (line_id, problem_description_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."line_problem_descriptions" TO authenticated;
GRANT ALL ON public."line_problem_descriptions" TO service_role;
ALTER TABLE public."line_problem_descriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."line_problem_descriptions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."line_problem_descriptions" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."line_problem_descriptions" ADD COLUMN IF NOT EXISTS "problem_description_id" uuid;
ALTER TABLE public."line_problem_descriptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."checklists" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "problem_description_id" uuid NOT NULL,
  "type" text DEFAULT 'Safety'::text NOT NULL,
  "description" text NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checklists_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."checklists" TO authenticated;
GRANT ALL ON public."checklists" TO service_role;
ALTER TABLE public."checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "problem_description_id" uuid;
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'Safety'::text;
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "is_required" boolean DEFAULT true;
ALTER TABLE public."checklists" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."checklist_responses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "checklist_id" uuid NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "completed_by" uuid,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checklist_responses_pkey" PRIMARY KEY (id),
  CONSTRAINT "checklist_responses_work_order_id_checklist_id_key" UNIQUE (work_order_id, checklist_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."checklist_responses" TO authenticated;
GRANT ALL ON public."checklist_responses" TO service_role;
ALTER TABLE public."checklist_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "checklist_id" uuid;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "completed" boolean DEFAULT false;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "completed_by" uuid;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
ALTER TABLE public."checklist_responses" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."work_orders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "requester_name" text NOT NULL,
  "machine" text DEFAULT ''::text,
  "description" text NOT NULL,
  "status" public."wo_status" DEFAULT 'open'::wo_status NOT NULL,
  "operator_id" uuid,
  "engineer_id" uuid,
  "closed_by" uuid,
  "notified_engineers" text[] DEFAULT '{}'::text[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "wo_number" integer DEFAULT nextval('wo_number_seq'::regclass) NOT NULL,
  "signed_by_name" text,
  "notes" text DEFAULT ''::text,
  "received_at" timestamp with time zone,
  "arrived_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "checklist_completed" boolean DEFAULT false NOT NULL,
  "paused_at" timestamp with time zone,
  "total_paused_minutes" integer DEFAULT 0 NOT NULL,
  "engineer_name" text,
  "pause_reason" text DEFAULT ''::text NOT NULL,
  "operator_signature_name" text,
  "line_stopped" boolean DEFAULT false NOT NULL,
  "line_stopped_at" timestamp with time zone,
  "line_stopped_by" uuid,
  "line_resumed_at" timestamp with time zone,
  "line_resumed_by" uuid,
  "recurrence_of_wo_id" uuid,
  "locked_engineer_id" uuid,
  "locked_at" timestamp with time zone,
  "reopen_count" integer DEFAULT 0 NOT NULL,
  "current_episode" integer DEFAULT 1 NOT NULL,
  "engineer_notified_acknowledged_at" timestamp with time zone,
  "line_at_time" text,
  "line_id" uuid,
  "mobile_asset_id" uuid,
  "physical_line_id" uuid,
  "collaborator_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "collaborator_names" text[] DEFAULT '{}'::text[] NOT NULL,
  "intouch_machine_id" text,
  "intouch_downtime_code" text,
  CONSTRAINT "work_orders_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."work_orders" TO authenticated;
GRANT ALL ON public."work_orders" TO service_role;
ALTER TABLE public."work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "requester_name" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "machine" text DEFAULT ''::text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "status" public."wo_status" DEFAULT 'open'::wo_status;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "operator_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "engineer_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "notified_engineers" text[] DEFAULT '{}'::text[];
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "wo_number" integer DEFAULT nextval('wo_number_seq'::regclass);
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "signed_by_name" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "notes" text DEFAULT ''::text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "received_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "arrived_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium'::text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "checklist_completed" boolean DEFAULT false;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "total_paused_minutes" integer DEFAULT 0;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "engineer_name" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "pause_reason" text DEFAULT ''::text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "operator_signature_name" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_stopped" boolean DEFAULT false;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_stopped_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_stopped_by" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_resumed_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_resumed_by" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "recurrence_of_wo_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "locked_engineer_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "reopen_count" integer DEFAULT 0;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "current_episode" integer DEFAULT 1;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "engineer_notified_acknowledged_at" timestamp with time zone;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_at_time" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "mobile_asset_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "physical_line_id" uuid;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "collaborator_ids" uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "collaborator_names" text[] DEFAULT '{}'::text[];
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "intouch_machine_id" text;
ALTER TABLE public."work_orders" ADD COLUMN IF NOT EXISTS "intouch_downtime_code" text;

CREATE TABLE IF NOT EXISTS public."wo_episodes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "episode_number" integer NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reopened_by" uuid,
  "reopen_reason" text,
  "accepted_at" timestamp with time zone,
  "arrived_at" timestamp with time zone,
  "started_work_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "finish_engineer_id" uuid,
  "finish_pin_verified" boolean DEFAULT false NOT NULL,
  "notes" text,
  CONSTRAINT "wo_episodes_pkey" PRIMARY KEY (id),
  CONSTRAINT "wo_episodes_work_order_id_episode_number_key" UNIQUE (work_order_id, episode_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."wo_episodes" TO authenticated;
GRANT ALL ON public."wo_episodes" TO service_role;
ALTER TABLE public."wo_episodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "episode_number" integer;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "reopened_by" uuid;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "reopen_reason" text;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "arrived_at" timestamp with time zone;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "started_work_at" timestamp with time zone;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "finish_engineer_id" uuid;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "finish_pin_verified" boolean DEFAULT false;
ALTER TABLE public."wo_episodes" ADD COLUMN IF NOT EXISTS "notes" text;

CREATE TABLE IF NOT EXISTS public."work_order_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "engineer_id" uuid NOT NULL,
  "engineer_name" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "work_order_logs_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."work_order_logs" TO authenticated;
GRANT ALL ON public."work_order_logs" TO service_role;
ALTER TABLE public."work_order_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "engineer_id" uuid;
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "engineer_name" text;
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "action" text;
ALTER TABLE public."work_order_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."wo_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "user_name" text NOT NULL,
  "message" text DEFAULT ''::text NOT NULL,
  "image_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wo_messages_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."wo_messages" TO authenticated;
GRANT ALL ON public."wo_messages" TO service_role;
ALTER TABLE public."wo_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "user_name" text;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "message" text DEFAULT ''::text;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE public."wo_messages" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."wo_photos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "photo_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wo_photos_pkey" PRIMARY KEY (id),
  CONSTRAINT "valid_photo_type" CHECK ((photo_type = ANY (ARRAY['before'::text, 'after'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."wo_photos" TO authenticated;
GRANT ALL ON public."wo_photos" TO service_role;
ALTER TABLE public."wo_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "photo_type" text;
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "storage_path" text;
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "uploaded_by" uuid;
ALTER TABLE public."wo_photos" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."wo_pauses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "wo_id" uuid,
  "paused_at" timestamp with time zone NOT NULL,
  "resumed_at" timestamp with time zone,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wo_pauses_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."wo_pauses" TO authenticated;
GRANT ALL ON public."wo_pauses" TO service_role;
ALTER TABLE public."wo_pauses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "wo_id" uuid;
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "resumed_at" timestamp with time zone;
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE public."wo_pauses" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."parts_used" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "engineer_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "engineer_name" text DEFAULT ''::text NOT NULL,
  CONSTRAINT "parts_used_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."parts_used" TO authenticated;
GRANT ALL ON public."parts_used" TO service_role;
ALTER TABLE public."parts_used" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "product_id" uuid;
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "quantity" integer;
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "engineer_id" uuid;
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."parts_used" ADD COLUMN IF NOT EXISTS "engineer_name" text DEFAULT ''::text;

CREATE TABLE IF NOT EXISTS public."downtime_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "work_order_id" uuid NOT NULL,
  "stopped_at" timestamp with time zone NOT NULL,
  "stopped_by" uuid,
  "stopped_by_name" text,
  "stopped_reason" text,
  "resumed_at" timestamp with time zone,
  "resumed_by" uuid,
  "resumed_by_name" text,
  "resumed_note" text,
  "duration_minutes" integer DEFAULT 
CASE
    WHEN (resumed_at IS NOT NULL) THEN ((EXTRACT(epoch FROM (resumed_at - stopped_at)) / (60)::numeric))::integer
    ELSE NULL::integer
END,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_recurrence" boolean DEFAULT false NOT NULL,
  "episode_number" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "downtime_events_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."downtime_events" TO authenticated;
GRANT ALL ON public."downtime_events" TO service_role;
ALTER TABLE public."downtime_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "stopped_at" timestamp with time zone;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "stopped_by" uuid;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "stopped_by_name" text;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "stopped_reason" text;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "resumed_at" timestamp with time zone;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "resumed_by" uuid;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "resumed_by_name" text;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "resumed_note" text;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "duration_minutes" integer DEFAULT 
CASE
    WHEN (resumed_at IS NOT NULL) THEN ((EXTRACT(epoch FROM (resumed_at - stopped_at)) / (60)::numeric))::integer
    ELSE NULL::integer
END;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "is_recurrence" boolean DEFAULT false;
ALTER TABLE public."downtime_events" ADD COLUMN IF NOT EXISTS "episode_number" integer DEFAULT 1;

CREATE TABLE IF NOT EXISTS public."downtime" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "line" text NOT NULL,
  "machine" text,
  "reason" text NOT NULL,
  "category" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "reported_by" uuid,
  "work_order_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "downtime_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."downtime" TO authenticated;
GRANT ALL ON public."downtime" TO service_role;
ALTER TABLE public."downtime" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "machine" text;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "reported_by" uuid;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."downtime" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."machine_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL,
  "assigned_line" text NOT NULL,
  "assigned_from" timestamp with time zone DEFAULT now() NOT NULL,
  "assigned_until" timestamp with time zone,
  "moved_by" uuid,
  "notes" text,
  CONSTRAINT "machine_assignments_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."machine_assignments" TO authenticated;
GRANT ALL ON public."machine_assignments" TO service_role;
ALTER TABLE public."machine_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "machine_id" uuid;
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "assigned_line" text;
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "assigned_from" timestamp with time zone DEFAULT now();
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "assigned_until" timestamp with time zone;
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "moved_by" uuid;
ALTER TABLE public."machine_assignments" ADD COLUMN IF NOT EXISTS "notes" text;

CREATE TABLE IF NOT EXISTS public."machine_location_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL,
  "from_location" text DEFAULT ''::text NOT NULL,
  "to_location" text NOT NULL,
  "moved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "machine_location_log_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."machine_location_log" TO authenticated;
GRANT ALL ON public."machine_location_log" TO service_role;
ALTER TABLE public."machine_location_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "machine_id" uuid;
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "from_location" text DEFAULT ''::text;
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "to_location" text;
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "moved_by" uuid;
ALTER TABLE public."machine_location_log" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."machine_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid,
  "work_order_id" uuid,
  "problem_description" text,
  "action_taken" text,
  "part_used" text,
  "event_type" text DEFAULT 'repair'::text NOT NULL,
  "engineer_id" uuid,
  "engineer_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "machine_events_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."machine_events" TO authenticated;
GRANT ALL ON public."machine_events" TO service_role;
ALTER TABLE public."machine_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "machine_id" uuid;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "work_order_id" uuid;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "problem_description" text;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "action_taken" text;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "part_used" text;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "event_type" text DEFAULT 'repair'::text;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "engineer_id" uuid;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "engineer_name" text;
ALTER TABLE public."machine_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."pm_schedules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "machine" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "interval_days" integer NOT NULL,
  "last_done_at" timestamp with time zone,
  "next_due_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "assigned_engineer_id" uuid,
  "priority" text DEFAULT 'medium'::text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pm_schedules_pkey" PRIMARY KEY (id),
  CONSTRAINT "pm_schedules_interval_days_check" CHECK ((interval_days > 0))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."pm_schedules" TO authenticated;
GRANT ALL ON public."pm_schedules" TO service_role;
ALTER TABLE public."pm_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "machine" text;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "interval_days" integer;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "last_done_at" timestamp with time zone;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "next_due_at" timestamp with time zone;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "assigned_engineer_id" uuid;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium'::text;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."pm_schedules" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."pm_tasks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "title" text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pm_tasks_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."pm_tasks" TO authenticated;
GRANT ALL ON public."pm_tasks" TO service_role;
ALTER TABLE public."pm_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "schedule_id" uuid;
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "required" boolean DEFAULT true;
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;
ALTER TABLE public."pm_tasks" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."pm_executions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL,
  "done_by" uuid,
  "done_by_name" text,
  "done_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "checklist_state" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pm_executions_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."pm_executions" TO authenticated;
GRANT ALL ON public."pm_executions" TO service_role;
ALTER TABLE public."pm_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "schedule_id" uuid;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "done_by" uuid;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "done_by_name" text;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "done_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "checklist_state" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public."pm_executions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."sku_products" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "category" text,
  "target_per_hour" numeric DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "weight" numeric,
  CONSTRAINT "sku_products_pkey" PRIMARY KEY (id),
  CONSTRAINT "sku_products_code_key" UNIQUE (code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."sku_products" TO authenticated;
GRANT ALL ON public."sku_products" TO service_role;
ALTER TABLE public."sku_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "target_per_hour" numeric DEFAULT 0;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."sku_products" ADD COLUMN IF NOT EXISTS "weight" numeric;

CREATE TABLE IF NOT EXISTS public."production_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "line" text NOT NULL,
  "session_date" date NOT NULL,
  "shift" text NOT NULL,
  "started_by" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "leader_id" uuid,
  "leader_name" text,
  "staff_planned" integer DEFAULT 0,
  "staff_actual" integer DEFAULT 0,
  "locked" boolean DEFAULT false NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by" uuid,
  CONSTRAINT "production_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "production_sessions_line_session_date_shift_key" UNIQUE (line, session_date, shift),
  CONSTRAINT "production_sessions_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."production_sessions" TO authenticated;
GRANT ALL ON public."production_sessions" TO service_role;
ALTER TABLE public."production_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "session_date" date;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "started_by" uuid;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "leader_id" uuid;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "leader_name" text;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "staff_planned" integer DEFAULT 0;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "staff_actual" integer DEFAULT 0;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "locked" boolean DEFAULT false;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
ALTER TABLE public."production_sessions" ADD COLUMN IF NOT EXISTS "locked_by" uuid;

CREATE TABLE IF NOT EXISTS public."production_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "sku_id" uuid NOT NULL,
  "planned_qty" numeric DEFAULT 0 NOT NULL,
  "actual_qty" numeric DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "target_qty" numeric,
  CONSTRAINT "production_items_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."production_items" TO authenticated;
GRANT ALL ON public."production_items" TO service_role;
ALTER TABLE public."production_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "planned_qty" numeric DEFAULT 0;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "actual_qty" numeric DEFAULT 0;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_items" ADD COLUMN IF NOT EXISTS "target_qty" numeric;

CREATE TABLE IF NOT EXISTS public."production_targets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sku_id" uuid NOT NULL,
  "line" text NOT NULL,
  "shift" text NOT NULL,
  "target_qty" numeric DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_targets_pkey" PRIMARY KEY (id),
  CONSTRAINT "production_targets_sku_id_line_shift_key" UNIQUE (sku_id, line, shift),
  CONSTRAINT "production_targets_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."production_targets" TO authenticated;
GRANT ALL ON public."production_targets" TO service_role;
ALTER TABLE public."production_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "sku_id" uuid;
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "target_qty" numeric DEFAULT 0;
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_targets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."production_downtimes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "occurred_date" date DEFAULT CURRENT_DATE NOT NULL,
  "shift" text NOT NULL,
  "line" text NOT NULL,
  "category" text NOT NULL,
  "reason" text,
  "duration_minutes" integer NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "leader_name" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_downtimes_pkey" PRIMARY KEY (id),
  CONSTRAINT "production_downtimes_duration_minutes_check" CHECK ((duration_minutes >= 0)),
  CONSTRAINT "production_downtimes_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."production_downtimes" TO authenticated;
GRANT ALL ON public."production_downtimes" TO service_role;
ALTER TABLE public."production_downtimes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "occurred_date" date DEFAULT CURRENT_DATE;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "leader_name" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."production_downtimes" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."quality_action_types" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "points" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "quality_action_types_pkey" PRIMARY KEY (id),
  CONSTRAINT "quality_action_types_code_key" UNIQUE (code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."quality_action_types" TO authenticated;
GRANT ALL ON public."quality_action_types" TO service_role;
ALTER TABLE public."quality_action_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."quality_action_types" ADD COLUMN IF NOT EXISTS "points" integer DEFAULT 1;

CREATE TABLE IF NOT EXISTS public."quality_actions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid,
  "action_type_id" uuid NOT NULL,
  "line" text,
  "description" text,
  "recorded_by" uuid,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "shift" text,
  "leader_id" uuid,
  "leader_name" text,
  "points" integer DEFAULT 1,
  CONSTRAINT "quality_actions_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."quality_actions" TO authenticated;
GRANT ALL ON public."quality_actions" TO service_role;
ALTER TABLE public."quality_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "session_id" uuid;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "action_type_id" uuid;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "recorded_by" uuid;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "recorded_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "leader_id" uuid;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "leader_name" text;
ALTER TABLE public."quality_actions" ADD COLUMN IF NOT EXISTS "points" integer DEFAULT 1;

CREATE TABLE IF NOT EXISTS public."rag_weekly_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "entry_date" date NOT NULL,
  "line" text NOT NULL,
  "shift" text NOT NULL,
  "plan_qty" numeric DEFAULT 0 NOT NULL,
  "actual_qty" numeric DEFAULT 0 NOT NULL,
  "upm_target" numeric DEFAULT 0 NOT NULL,
  "upm_actual" numeric DEFAULT 0 NOT NULL,
  "downtime_min" numeric DEFAULT 0 NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rag_weekly_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "rag_weekly_entries_entry_date_line_shift_key" UNIQUE (entry_date, line, shift),
  CONSTRAINT "rag_weekly_entries_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."rag_weekly_entries" TO authenticated;
GRANT ALL ON public."rag_weekly_entries" TO service_role;
ALTER TABLE public."rag_weekly_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "entry_date" date;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "plan_qty" numeric DEFAULT 0;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "actual_qty" numeric DEFAULT 0;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "upm_target" numeric DEFAULT 0;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "upm_actual" numeric DEFAULT 0;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "downtime_min" numeric DEFAULT 0;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."rag_weekly_entries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."rag_week_exclusions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "entry_date" date NOT NULL,
  "line" text NOT NULL,
  "shift" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rag_week_exclusions_pkey" PRIMARY KEY (id),
  CONSTRAINT "rag_week_exclusions_entry_date_line_shift_key" UNIQUE (entry_date, line, shift),
  CONSTRAINT "rag_week_exclusions_shift_check" CHECK ((shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text, 'ALL'::text])))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."rag_week_exclusions" TO authenticated;
GRANT ALL ON public."rag_week_exclusions" TO service_role;
ALTER TABLE public."rag_week_exclusions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "entry_date" date;
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "line" text;
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "shift" text;
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE public."rag_week_exclusions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."shift_report_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "day_enabled" boolean DEFAULT false NOT NULL,
  "night_enabled" boolean DEFAULT false NOT NULL,
  "extra_recipients" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "include_admins_managers" boolean DEFAULT true NOT NULL,
  "last_sent_day_at" timestamp with time zone,
  "last_sent_night_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shift_report_settings_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."shift_report_settings" TO authenticated;
GRANT ALL ON public."shift_report_settings" TO service_role;
ALTER TABLE public."shift_report_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "day_enabled" boolean DEFAULT false;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "night_enabled" boolean DEFAULT false;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "extra_recipients" text[] DEFAULT ARRAY[]::text[];
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "include_admins_managers" boolean DEFAULT true;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "last_sent_day_at" timestamp with time zone;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "last_sent_night_at" timestamp with time zone;
ALTER TABLE public."shift_report_settings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."intouch_machine_map" (
  "intouch_machine_id" text NOT NULL,
  "intouch_machine_name" text,
  "machine_name" text,
  "line_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "last_status" integer,
  "last_downtime_code" text,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "prod_dt_started_at" timestamp with time zone,
  "prod_dt_code" text,
  CONSTRAINT "intouch_machine_map_pkey" PRIMARY KEY (intouch_machine_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."intouch_machine_map" TO authenticated;
GRANT ALL ON public."intouch_machine_map" TO service_role;
ALTER TABLE public."intouch_machine_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "intouch_machine_id" text;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "intouch_machine_name" text;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "machine_name" text;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "line_id" uuid;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "last_status" integer;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "last_downtime_code" text;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "prod_dt_started_at" timestamp with time zone;
ALTER TABLE public."intouch_machine_map" ADD COLUMN IF NOT EXISTS "prod_dt_code" text;

CREATE TABLE IF NOT EXISTS public."intouch_stop_code_map" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "stop_code" text NOT NULL,
  "label" text NOT NULL,
  "default_priority" text DEFAULT 'medium'::text NOT NULL,
  "category" text,
  "line_hint" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "requires_wo" boolean DEFAULT true NOT NULL,
  CONSTRAINT "intouch_stop_code_map_pkey" PRIMARY KEY (id),
  CONSTRAINT "intouch_stop_code_map_stop_code_key" UNIQUE (stop_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."intouch_stop_code_map" TO authenticated;
GRANT ALL ON public."intouch_stop_code_map" TO service_role;
ALTER TABLE public."intouch_stop_code_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "stop_code" text;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "default_priority" text DEFAULT 'medium'::text;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "line_hint" text;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true;
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."intouch_stop_code_map" ADD COLUMN IF NOT EXISTS "requires_wo" boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public."intouch_webhook_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_ip" text,
  "headers" jsonb,
  "payload" jsonb,
  "parsed_ok" boolean DEFAULT false NOT NULL,
  "error_message" text,
  "created_wo_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "intouch_webhook_logs_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."intouch_webhook_logs" TO authenticated;
GRANT ALL ON public."intouch_webhook_logs" TO service_role;
ALTER TABLE public."intouch_webhook_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "received_at" timestamp with time zone DEFAULT now();
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "source_ip" text;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "headers" jsonb;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "payload" jsonb;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "parsed_ok" boolean DEFAULT false;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "error_message" text;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "created_wo_id" uuid;
ALTER TABLE public."intouch_webhook_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."teams_webhook_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event" text NOT NULL,
  "title" text,
  "success" boolean NOT NULL,
  "status_code" integer,
  "attempts" integer DEFAULT 1 NOT NULL,
  "error_message" text,
  "response_body" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teams_webhook_logs_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."teams_webhook_logs" TO authenticated;
GRANT ALL ON public."teams_webhook_logs" TO service_role;
ALTER TABLE public."teams_webhook_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "event" text;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "success" boolean;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "status_code" integer;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 1;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "error_message" text;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "response_body" text;
ALTER TABLE public."teams_webhook_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE TABLE IF NOT EXISTS public."audit_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "user_name" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "details" jsonb DEFAULT '{}'::jsonb,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public."audit_logs" TO authenticated;
GRANT ALL ON public."audit_logs" TO service_role;
ALTER TABLE public."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "user_name" text;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "action" text;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "entity_type" text;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "entity_id" text;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" text;
ALTER TABLE public."audit_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now();

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$


CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$function$


CREATE OR REPLACE FUNCTION public.current_device_token()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(
    current_setting('request.headers', true)::json ->> 'x-device-token',
    ''
  );
$function$


CREATE OR REPLACE FUNCTION public.current_device_line()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.line_id
  FROM public.devices d
  WHERE d.device_token = public.current_device_token()
  LIMIT 1;
$function$


CREATE OR REPLACE FUNCTION public.current_device_line_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(dl.line_id), ARRAY[]::uuid[])
  FROM public.device_lines dl
  JOIN public.devices d ON d.id = dl.device_id
  WHERE d.device_token = public.current_device_token();
$function$


CREATE OR REPLACE FUNCTION public.accept_wo_with_pin(_wo_id uuid, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _engineer_name TEXT;
  _current_ep INT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, current_episode INTO _wo_locked, _current_ep
    FROM public.work_orders WHERE id = _wo_id;
  IF _wo_locked IS NOT NULL AND _wo_locked <> _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  UPDATE public.work_orders SET
    status = 'received'::wo_status,
    engineer_id = _user_id,
    engineer_name = _engineer_name,
    locked_engineer_id = _user_id,
    locked_at = COALESCE(locked_at, now()),
    received_at = COALESCE(received_at, now())
  WHERE id = _wo_id;

  -- Stamp accepted_at on the open episode (if any)
  UPDATE public.wo_episodes
     SET accepted_at = COALESCE(accepted_at, now())
   WHERE work_order_id = _wo_id
     AND finished_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'received');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'engineer_id', _user_id, 'engineer_name', _engineer_name);
END;
$function$


CREATE OR REPLACE FUNCTION public.acknowledge_wo_alert(_wo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.work_orders
     SET engineer_notified_acknowledged_at = COALESCE(engineer_notified_acknowledged_at, now())
   WHERE id = _wo_id
     AND (
       engineer_id IS NULL
       OR engineer_id = _uid
       OR locked_engineer_id = _uid
       OR public.has_role(_uid, 'admin'::app_role)
       OR public.has_role(_uid, 'engineer'::app_role)
     );
END $function$


CREATE OR REPLACE FUNCTION public.add_wo_collaborator(_wo_id uuid, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ok boolean;
  _name text;
  _primary uuid;
  _status text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_uid, _pin) INTO _ok;
  IF NOT COALESCE(_ok, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, status::text INTO _primary, _status
  FROM public.work_orders WHERE id = _wo_id;

  IF _primary IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_accepted_yet');
  END IF;
  IF _primary = _uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_primary');
  END IF;
  IF _status NOT IN ('received', 'arrived', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_active');
  END IF;

  SELECT name INTO _name FROM public.profiles WHERE id = _uid;
  _name := COALESCE(_name, 'Engineer');

  UPDATE public.work_orders
  SET
    collaborator_ids = CASE
      WHEN _uid = ANY(COALESCE(collaborator_ids, ARRAY[]::uuid[]))
      THEN collaborator_ids
      ELSE array_append(COALESCE(collaborator_ids, ARRAY[]::uuid[]), _uid)
    END,
    collaborator_names = CASE
      WHEN _name = ANY(COALESCE(collaborator_names, ARRAY[]::text[]))
      THEN collaborator_names
      ELSE array_append(COALESCE(collaborator_names, ARRAY[]::text[]), _name)
    END
  WHERE id = _wo_id;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _uid, _name, 'collaborator_joined');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'engineer_id', _uid, 'engineer_name', _name);
END;
$function$


CREATE OR REPLACE FUNCTION public.admin_list_device_tokens()
 RETURNS TABLE(id uuid, device_token text, label text, line_id uuid, last_seen_at timestamp with time zone, paired_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;

  RETURN QUERY
  SELECT d.id, d.device_token, d.label, d.line_id, d.last_seen_at, d.paired_at
  FROM public.devices d
  ORDER BY d.last_seen_at DESC NULLS LAST;
END;
$function$


CREATE OR REPLACE FUNCTION public.finish_wo_with_pin(_wo_id uuid, _pin text, _signed_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _collabs UUID[];
  _engineer_name TEXT;
  _all_names TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, COALESCE(collaborator_ids, ARRAY[]::uuid[])
    INTO _wo_locked, _collabs
    FROM public.work_orders WHERE id = _wo_id;

  IF _wo_locked IS NOT NULL
     AND _wo_locked <> _user_id
     AND NOT (_user_id = ANY(_collabs)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  -- Build a combined signed_by_name including all collaborators.
  SELECT
    COALESCE(_signed_by_name, _engineer_name, 'Engineer')
    || CASE
         WHEN array_length(COALESCE(collaborator_names, ARRAY[]::text[]), 1) > 0
         THEN ' + ' || array_to_string(collaborator_names, ', ')
         ELSE ''
       END
  INTO _all_names
  FROM public.work_orders WHERE id = _wo_id;

  UPDATE public.work_orders SET
    status = 'finished'::wo_status,
    finished_at = now(),
    signed_by_name = _all_names
  WHERE id = _wo_id;

  UPDATE public.wo_episodes
     SET finished_at = COALESCE(finished_at, now()),
         finish_engineer_id = COALESCE(finish_engineer_id, _user_id),
         finish_pin_verified = true
   WHERE work_order_id = _wo_id
     AND finished_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'finished');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$function$


CREATE OR REPLACE FUNCTION public.get_device_line(_token text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT line_id FROM public.devices WHERE device_token = _token LIMIT 1;
$function$


CREATE OR REPLACE FUNCTION public.get_own_labor_rate()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(labor_rate, 0) FROM public.profiles WHERE id = auth.uid();
$function$


CREATE OR REPLACE FUNCTION public.get_profile_labor_rate(_user_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT labor_rate INTO _rate FROM public.profiles WHERE id = _user_id;
  RETURN COALESCE(_rate, 0);
END;
$function$


CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$function$


CREATE OR REPLACE FUNCTION public.guard_engineer_pin_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only enforce when there is an authenticated user (skip for service role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins are always allowed
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- INSERT: managers may insert but pin_hash must be a placeholder set by an edge function path.
  -- We reject any INSERT by non-admin authenticated users that includes a pin_hash directly,
  -- forcing PIN setup via the secured RPC (set_engineer_pin_standalone).
  IF TG_OP = 'INSERT' THEN
    IF NEW.pin_hash IS NOT NULL AND NEW.pin_hash <> '' AND NEW.pin_hash <> 'temp' THEN
      RAISE EXCEPTION 'Only admins may set pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: block any change to pin_hash by non-admins
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
      RAISE EXCEPTION 'Only admins may modify pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  -- Use FOR UPDATE to lock rows and prevent race condition
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles FOR UPDATE
  ) INTO is_first_user;

  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );

  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.import_sku_products(_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;

  WITH prepared AS (
    SELECT DISTINCT ON (lower(trim(item->>'code')))
      trim(item->>'code') AS code,
      trim(item->>'name') AS name,
      nullif(trim(coalesce(item->>'category', '')), '') AS category,
      CASE
        WHEN nullif(trim(coalesce(item->>'target_per_hour', '')), '') IS NULL THEN 0::numeric
        WHEN trim(item->>'target_per_hour') ~ '^[0-9]+([\.,][0-9]+)?$' THEN replace(trim(item->>'target_per_hour'), ',', '.')::numeric
        ELSE 0::numeric
      END AS target_per_hour,
      COALESCE((item->>'active')::boolean, true) AS active
    FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) AS item
    WHERE nullif(trim(coalesce(item->>'code', '')), '') IS NOT NULL
      AND nullif(trim(coalesce(item->>'name', '')), '') IS NOT NULL
    ORDER BY lower(trim(item->>'code')), length(trim(item->>'name')) DESC
  ), upserted AS (
    INSERT INTO public.sku_products (code, name, category, target_per_hour, active)
    SELECT code, name, category, target_per_hour, active
    FROM prepared
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      target_per_hour = EXCLUDED.target_per_hour,
      active = EXCLUDED.active,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO _count FROM upserted;

  RETURN jsonb_build_object('success', true, 'count', _count);
END;
$function$


CREATE OR REPLACE FUNCTION public.list_active_profile_names()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name
  FROM public.profiles p
  WHERE p.active = true
  ORDER BY p.name ASC;
$function$


CREATE OR REPLACE FUNCTION public.list_engineer_names()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.name
  FROM public.engineers e
  WHERE e.is_active = true
  ORDER BY e.name ASC;
$function$


CREATE OR REPLACE FUNCTION public.list_operator_account_user_ids()
 RETURNS TABLE(user_id uuid, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT o.user_id, o.email FROM public.operator_line_accounts o;
END;
$function$


CREATE OR REPLACE FUNCTION public.list_profile_labor_rates()
 RETURNS TABLE(id uuid, name text, labor_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT p.id, p.name, p.labor_rate FROM public.profiles p;
END;
$function$


CREATE OR REPLACE FUNCTION public.list_tablet_accounts_public()
 RETURNS TABLE(id uuid, label text, line_ids uuid[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.label, o.line_ids
  FROM public.operator_line_accounts o
  ORDER BY o.label ASC;
$function$


CREATE OR REPLACE FUNCTION public.log_audit_event(_action text, _entity_type text, _entity_id text DEFAULT NULL::text, _details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate input lengths
  IF length(_action) > 100 OR length(_entity_type) > 100 THEN
    RAISE EXCEPTION 'Action or entity_type too long';
  END IF;

  IF _entity_id IS NOT NULL AND length(_entity_id) > 200 THEN
    RAISE EXCEPTION 'entity_id too long';
  END IF;

  IF pg_column_size(_details) > 10000 THEN
    RAISE EXCEPTION 'Details payload too large';
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    COALESCE((SELECT name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    _action,
    _entity_type,
    _entity_id,
    _details
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.log_wo_retrigger(_wo_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id  uuid := auth.uid();
  _user_name text;
  _wo_number int;
  _retrigger_count int;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT wo_number INTO _wo_number FROM public.work_orders WHERE id = _wo_id;
  IF _wo_number IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  SELECT COALESCE(name, email) INTO _user_name
    FROM public.profiles WHERE id = _user_id;
  _user_name := COALESCE(_user_name, 'Operator');

  -- Append a log line (timeline / history)
  INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
  VALUES (
    _wo_id,
    _user_id,
    _user_name,
    'problem_retriggered: ' || COALESCE(NULLIF(_reason, ''), 'Same problem reported again')
  );

  -- Append a note line on the WO itself so it shows in Observations
  UPDATE public.work_orders
     SET notes = COALESCE(notes, '') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                 '[Retriggered — ' || to_char(now() AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') ||
                 ' — ' || _user_name || '] ' || COALESCE(NULLIF(_reason,''), 'Same problem reported again')
   WHERE id = _wo_id;

  -- Count retriggers for this WO
  SELECT COUNT(*) INTO _retrigger_count
    FROM public.work_order_logs
   WHERE work_order_id = _wo_id
     AND action LIKE 'problem_retriggered%';

  RETURN jsonb_build_object(
    'success', true,
    'wo_number', _wo_number,
    'retrigger_count', _retrigger_count
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.move_machine_to_line(_machine_id uuid, _new_line text, _notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cat public.machine_category;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT category INTO _cat FROM public.machines WHERE id = _machine_id;
  IF _cat IS NULL THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF _cat <> 'line_mobile' THEN
    RAISE EXCEPTION 'Machine is not mobile (category=%)', _cat;
  END IF;

  IF NOT (public.has_role(_uid,'admin'::app_role) OR public.has_role(_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: only admin or manager can move mobile machines';
  END IF;

  UPDATE public.machine_assignments
     SET assigned_until = now()
   WHERE machine_id = _machine_id AND assigned_until IS NULL;

  INSERT INTO public.machine_assignments(machine_id, assigned_line, moved_by, notes)
  VALUES (_machine_id, _new_line, _uid, _notes);

  UPDATE public.machines
     SET current_line = _new_line
   WHERE id = _machine_id;

  PERFORM public.log_audit_event(
    'machine_moved', 'machine', _machine_id::text,
    jsonb_build_object('new_line', _new_line, 'notes', _notes)
  );
END $function$


CREATE OR REPLACE FUNCTION public.pair_device(_token text, _line_id uuid, _label text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.devices
    SET line_id = _line_id, label = COALESCE(_label, label),
        paired_by = auth.uid(), paired_at = now()
    WHERE device_token = _token;
  IF NOT FOUND THEN
    INSERT INTO public.devices(device_token, line_id, label, paired_by, paired_at)
    VALUES (_token, _line_id, _label, auth.uid(), now());
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.pair_device_lines(_token text, _line_ids uuid[], _label text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _device_id uuid;
  _primary_line uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Find or auto-register device row
  SELECT id INTO _device_id FROM public.devices WHERE device_token = _token;
  IF _device_id IS NULL THEN
    INSERT INTO public.devices(device_token, label, paired_by, paired_at)
    VALUES (_token, _label, auth.uid(), now())
    RETURNING id INTO _device_id;
  ELSE
    UPDATE public.devices
      SET label = COALESCE(_label, label),
          paired_by = auth.uid(),
          paired_at = now()
      WHERE id = _device_id;
  END IF;

  -- Replace the allowed-line set atomically
  DELETE FROM public.device_lines WHERE device_id = _device_id;

  IF _line_ids IS NOT NULL AND array_length(_line_ids, 1) > 0 THEN
    INSERT INTO public.device_lines (device_id, line_id)
    SELECT _device_id, lid
    FROM unnest(_line_ids) AS lid
    ON CONFLICT (device_id, line_id) DO NOTHING;

    -- Update legacy cache to the first line for backward compat
    _primary_line := _line_ids[1];
    UPDATE public.devices SET line_id = _primary_line WHERE id = _device_id;
  ELSE
    UPDATE public.devices SET line_id = NULL WHERE id = _device_id;
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.pm_apply_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pm_schedules
     SET last_done_at = NEW.done_at
   WHERE id = NEW.schedule_id;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.pm_recompute_next_due()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.last_done_at IS NOT NULL THEN
    NEW.next_due_at := NEW.last_done_at + (NEW.interval_days || ' days')::interval;
  ELSIF NEW.next_due_at IS NULL THEN
    NEW.next_due_at := now() + (NEW.interval_days || ' days')::interval;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.recalculate_health_scores()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _machine_name text;
  _wo_count integer;
  _long_repair_count integer;
  _recurrent_count integer;
  _score integer;
BEGIN
  _machine_name := COALESCE(NEW.machine, OLD.machine);
  
  -- Count WOs in last 30 days
  SELECT COUNT(*) INTO _wo_count
  FROM work_orders
  WHERE machine = _machine_name
    AND created_at >= now() - interval '30 days';
  
  -- Count WOs with repair > 120 min in last 30 days
  SELECT COUNT(*) INTO _long_repair_count
  FROM work_orders
  WHERE machine = _machine_name
    AND created_at >= now() - interval '30 days'
    AND started_at IS NOT NULL
    AND finished_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 > 120;
  
  -- Count recurrent problems (same problem >= 3 times in 30 days)
  SELECT COUNT(*) INTO _recurrent_count
  FROM (
    SELECT description, COUNT(*) as cnt
    FROM work_orders
    WHERE machine = _machine_name
      AND created_at >= now() - interval '30 days'
    GROUP BY description
    HAVING COUNT(*) >= 3
  ) sub;
  
  -- Calculate score: 100 - 5*wo_count - 10*long_repairs - 15*recurrent
  _score := GREATEST(0, 100 - (_wo_count * 5) - (_long_repair_count * 10) - (_recurrent_count * 15));
  
  -- Update machine health score
  UPDATE machines SET health_score = _score WHERE name = _machine_name;
  
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.reduce_stock_on_parts_used()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.products
  SET quantity = quantity - NEW.quantity
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.reopen_wo_as_recurrence(_wo_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _user_role public.app_role;
  _user_name text;
  _orig record;
  _new_episode int;
  _note text;
  _is_same_line_operator boolean := false;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, wo_number, requester_name, machine, description, priority,
         operator_id, line_id, mobile_asset_id, status, notes,
         engineer_id, engineer_name, current_episode, reopen_count
    INTO _orig
    FROM public.work_orders
   WHERE id = _wo_id;

  IF _orig.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _orig.status::text NOT IN ('finished', 'closed', 'completed', 'force_closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_closed');
  END IF;

  SELECT public.current_user_role() INTO _user_role;

  IF _orig.line_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.operator_line_accounts ola
      WHERE ola.user_id = _user_id
        AND _orig.line_id = ANY(ola.line_ids)
    ) INTO _is_same_line_operator;
  END IF;

  IF NOT (
    _user_role IN ('admin'::public.app_role, 'manager'::public.app_role)
    OR _orig.operator_id = _user_id
    OR (_user_role = 'operator'::public.app_role AND _is_same_line_operator)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(p.name, p.email, 'Operator') INTO _user_name
    FROM public.profiles p WHERE p.id = _user_id;
  _user_name := COALESCE(NULLIF(_user_name, ''), 'Operator');

  -- Close ANY leftover open episode (by current_episode OR by finished_at IS NULL)
  UPDATE public.wo_episodes
    SET finished_at = COALESCE(finished_at, now())
    WHERE work_order_id = _wo_id
      AND finished_at IS NULL;

  SELECT COALESCE(MAX(episode_number), 0) + 1 INTO _new_episode
    FROM public.wo_episodes WHERE work_order_id = _wo_id;

  INSERT INTO public.wo_episodes
    (work_order_id, episode_number, reopened_by, reopen_reason, accepted_at)
  VALUES (_wo_id, _new_episode, _user_id, _reason, NULL);

  _note := '[Reopened (recurrence) — ' || to_char(now() AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI')
        || ' — ' || _user_name || '] '
        || COALESCE(NULLIF(_reason, ''), 'Same problem reported again');

  UPDATE public.work_orders SET
    status = 'open'::wo_status,
    reopen_count = COALESCE(reopen_count, 0) + 1,
    current_episode = _new_episode,
    locked_engineer_id = _orig.engineer_id,
    engineer_id = _orig.engineer_id,
    engineer_name = _orig.engineer_name,
    received_at = NULL,
    arrived_at = NULL,
    started_at = NULL,
    finished_at = NULL,
    closed_at = NULL,
    closed_by = NULL,
    completed_at = NULL,
    signed_by_name = NULL,
    line_stopped = true,
    line_stopped_at = now(),
    line_stopped_by = _user_id,
    line_resumed_at = NULL,
    line_resumed_by = NULL,
    notes = COALESCE(notes, '') ||
            CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END || _note
  WHERE id = _wo_id;

  INSERT INTO public.downtime_events
    (work_order_id, stopped_at, stopped_by, stopped_by_name, stopped_reason,
     is_recurrence, episode_number)
  VALUES (_wo_id, now(), _user_id, _user_name, _reason, true, _new_episode);

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, _user_name, 'reopened_recurrence: ' || COALESCE(NULLIF(_reason,''), 'Same problem'));
  EXCEPTION WHEN foreign_key_violation OR unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'wo_id', _wo_id,
    'wo_number', _orig.wo_number,
    'episode_number', _new_episode,
    'reopen_count', COALESCE(_orig.reopen_count, 0) + 1
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.reopen_wo_recurrence(_wo_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _new_episode INT;
  _prev_engineer UUID;
  _prev_engineer_name TEXT;
  _wo_status TEXT;
  _current_ep INT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status::text, engineer_id, engineer_name, current_episode
    INTO _wo_status, _prev_engineer, _prev_engineer_name, _current_ep
    FROM public.work_orders WHERE id = _wo_id;

  IF _wo_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _wo_status NOT IN ('finished', 'closed', 'completed') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'wo_not_closed_use_stopped_again');
  END IF;

  UPDATE public.wo_episodes
    SET finished_at = COALESCE(finished_at, now())
    WHERE work_order_id = _wo_id AND episode_number = _current_ep;

  SELECT COALESCE(MAX(episode_number), 0) + 1 INTO _new_episode
    FROM public.wo_episodes WHERE work_order_id = _wo_id;

  INSERT INTO public.wo_episodes
    (work_order_id, episode_number, reopened_by, reopen_reason, accepted_at)
  VALUES (_wo_id, _new_episode, _user_id, _reason, now());

  UPDATE public.work_orders SET
    status = 'received'::wo_status,
    reopen_count = reopen_count + 1,
    current_episode = _new_episode,
    locked_engineer_id = _prev_engineer,
    engineer_id = _prev_engineer,
    engineer_name = _prev_engineer_name,
    received_at = now(),
    finished_at = NULL,
    closed_at = NULL,
    signed_by_name = NULL
  WHERE id = _wo_id;

  INSERT INTO public.downtime_events
    (work_order_id, stopped_at, stopped_by, stopped_reason,
     is_recurrence, episode_number)
  VALUES (_wo_id, now(), _user_id, _reason, true, _new_episode);

  RETURN jsonb_build_object('success', true,
    'episode_number', _new_episode,
    'engineer_id', _prev_engineer);
END;
$function$


CREATE OR REPLACE FUNCTION public.set_admin_pin(_new_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.system_settings
  SET admin_pin = extensions.crypt(_new_pin, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = (SELECT id FROM public.system_settings LIMIT 1);
END;
$function$


CREATE OR REPLACE FUNCTION public.set_engineer_pin(_user_id uuid, _new_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF _new_pin IS NULL OR length(_new_pin) < 4 THEN
    RAISE EXCEPTION 'PIN must be at least 4 characters';
  END IF;

  UPDATE public.engineers
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf', 10))
  WHERE id = _user_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_engineer_pin_standalone(_engineer_id uuid, _new_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.engineers
  SET pin_hash = crypt(_new_pin, gen_salt('bf'))
  WHERE id = _engineer_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_machine_status_from_wo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _open_wo_count integer;
BEGIN
  -- Only act on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- When WO becomes open or in_progress, set machine to maintenance
  IF NEW.status IN ('open', 'in_progress') THEN
    UPDATE machines SET status = 'maintenance' WHERE name = NEW.machine;
  END IF;

  -- When WO is closed or finished, check if there are other active WOs for this machine
  IF NEW.status IN ('closed', 'finished', 'completed', 'force_closed') THEN
    SELECT COUNT(*) INTO _open_wo_count
    FROM work_orders
    WHERE machine = NEW.machine
      AND id != NEW.id
      AND status NOT IN ('closed', 'finished', 'completed', 'force_closed');

    IF _open_wo_count = 0 THEN
      UPDATE machines
      SET status = 'active',
          last_maintenance_date = now()
      WHERE name = NEW.machine;
    ELSE
      -- Still has open WOs, just update last_maintenance_date
      UPDATE machines
      SET last_maintenance_date = now()
      WHERE name = NEW.machine;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_rag_actual_from_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _session_id uuid;
  _date date;
  _line text;
  _shift text;
  _sum numeric;
BEGIN
  _session_id := COALESCE(NEW.session_id, OLD.session_id);
  SELECT session_date, line, shift INTO _date, _line, _shift
  FROM public.production_sessions WHERE id = _session_id;
  IF _date IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(actual_qty), 0) INTO _sum
  FROM public.production_items pi
  JOIN public.production_sessions ps ON ps.id = pi.session_id
  WHERE ps.session_date = _date AND ps.line = _line AND ps.shift = _shift;

  -- Update only if a RAG row exists; do not auto-create (plan ownership stays with supervisor).
  UPDATE public.rag_weekly_entries
     SET actual_qty = _sum, updated_at = now()
   WHERE entry_date = _date AND line = _line AND shift = _shift;

  RETURN NULL;
END;
$function$


CREATE OR REPLACE FUNCTION public.sync_wo_line_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _wo_id uuid := COALESCE(NEW.work_order_id, OLD.work_order_id);
BEGIN
  UPDATE public.work_orders wo
  SET
    line_stopped = EXISTS (
      SELECT 1 FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
    ),
    line_stopped_at = (
      SELECT stopped_at FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_stopped_by = (
      SELECT stopped_by FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_resumed_at = (
      SELECT resumed_at FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    ),
    line_resumed_by = (
      SELECT resumed_by FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    )
  WHERE wo.id = _wo_id;
  RETURN NULL;
END $function$


CREATE OR REPLACE FUNCTION public.touch_device(_token text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.devices SET last_seen_at = now() WHERE device_token = _token;
$function$


CREATE OR REPLACE FUNCTION public.unpair_device(_device_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  DELETE FROM public.device_lines WHERE device_id = _device_id;
  UPDATE public.devices
    SET line_id = NULL, paired_by = NULL, paired_at = NULL
    WHERE id = _device_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_engineer_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _score_delta integer := 0;
  _response_min integer;
  _repair_min integer;
  _sla_target integer;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'received' AND NEW.engineer_id IS NOT NULL AND NEW.received_at IS NOT NULL THEN
    _response_min := EXTRACT(EPOCH FROM (NEW.received_at::timestamp - NEW.created_at::timestamp)) / 60;
    IF _response_min <= 5 THEN
      _score_delta := _score_delta + 10;
    END IF;
    _sla_target := CASE NEW.priority
      WHEN 'critical' THEN 10
      WHEN 'high' THEN 30
      WHEN 'low' THEN 120
      ELSE 60
    END;
    IF _response_min > _sla_target THEN
      _score_delta := _score_delta - 15;
    END IF;
  END IF;

  IF NEW.status = 'finished' AND NEW.engineer_id IS NOT NULL AND NEW.started_at IS NOT NULL AND NEW.finished_at IS NOT NULL THEN
    _repair_min := EXTRACT(EPOCH FROM (NEW.finished_at::timestamp - NEW.started_at::timestamp)) / 60;
    _sla_target := CASE NEW.priority
      WHEN 'critical' THEN 10
      WHEN 'high' THEN 30
      WHEN 'low' THEN 120
      ELSE 60
    END;
    IF _repair_min <= _sla_target THEN
      _score_delta := _score_delta + 20;
    END IF;
    IF _repair_min > 120 THEN
      _score_delta := _score_delta - 30;
    END IF;
  END IF;

  IF _score_delta != 0 AND NEW.engineer_id IS NOT NULL THEN
    INSERT INTO public.engineer_scores (engineer_id, score, updated_at)
    VALUES (NEW.engineer_id, GREATEST(0, LEAST(100, _score_delta)), now())
    ON CONFLICT (engineer_id) DO UPDATE
    SET score = GREATEST(0, LEAST(100, engineer_scores.score + _score_delta)),
        updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.validate_downtime_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category NOT IN ('Mechanical', 'Electrical', 'Machine', 'Maintenance', 'Filler', 'Other') THEN
    RAISE EXCEPTION 'Invalid downtime category: %', NEW.category;
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.validate_machine_side()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  line_has_sides boolean;
BEGIN
  IF NEW.line_id IS NULL THEN
    -- Sem linha vinculada: força common
    IF NEW.side IN ('A','B') THEN
      RAISE EXCEPTION 'Machine without a linked line cannot have side A or B';
    END IF;
    RETURN NEW;
  END IF;

  SELECT has_sides INTO line_has_sides FROM public.lines WHERE id = NEW.line_id;

  IF line_has_sides = false AND NEW.side IN ('A','B') THEN
    RAISE EXCEPTION 'Line does not support sides A/B. Enable has_sides on the line first.';
  END IF;

  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.validate_stock_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  available_qty integer;
BEGIN
  SELECT quantity INTO available_qty
  FROM products WHERE id = NEW.product_id;
  
  IF available_qty IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  IF available_qty < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', available_qty, NEW.quantity;
  END IF;
  
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.verify_admin_pin(_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE admin_pin = extensions.crypt(_pin, admin_pin)
    LIMIT 1
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.verify_engineer_pin(_user_id uuid, _pin text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.engineers
    WHERE id = _user_id
      AND is_active = true
      AND pin_hash IS NOT NULL
      AND pin_hash = extensions.crypt(_pin, pin_hash)
  )
$function$


CREATE OR REPLACE FUNCTION public.verify_pin_by_code(_pin text)
 RETURNS TABLE(engineer_id uuid, engineer_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT e.id, e.name
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash = crypt(_pin, e.pin_hash);
END;
$function$


CREATE OR REPLACE FUNCTION public.verify_pin_with_lockout(_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.pin_attempts%ROWTYPE;
  _eng record;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  -- 30s, 60s, 120s, 300s (then stays at 300s)
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Use a stable identity for unauthenticated sessions too (tablet shared
  -- accounts are still authenticated as the operator user).
  SELECT * INTO _row FROM public.pin_attempts WHERE user_id = _uid FOR UPDATE;

  -- Currently locked? Refuse without checking the PIN.
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0
    );
  END IF;

  -- Verify the PIN against the engineers table.
  SELECT e.id, e.name INTO _eng
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash IS NOT NULL
    AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
  LIMIT 1;

  IF _eng.id IS NOT NULL THEN
    -- Success — wipe the counter for this user.
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', true,
      'engineer_id', _eng.id,
      'engineer_name', _eng.name
    );
  END IF;

  -- Failure — bump counter, possibly engage the next lockout step.
  IF _row.user_id IS NULL THEN
    INSERT INTO public.pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
    VALUES (_uid, 1, 0, _now, _now)
    RETURNING * INTO _row;
  ELSE
    UPDATE public.pin_attempts
       SET failures = _row.failures + 1,
           last_attempt = _now,
           updated_at = _now
     WHERE user_id = _uid
    RETURNING * INTO _row;
  END IF;

  IF _row.failures >= _max_free THEN
    _step := LEAST(_row.lockout_step + 1, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.pin_attempts
       SET lockout_step = _step,
           locked_until = _now + make_interval(secs => _wait),
           failures = 0,
           updated_at = _now
     WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', _wait,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'error', 'invalid_pin',
    'remaining', _max_free - _row.failures
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.wo_total_pause_seconds(_wo_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    SUM(EXTRACT(EPOCH FROM (COALESCE(resumed_at, now()) - paused_at))),
    0
  )::int
  FROM public.wo_pauses WHERE wo_id = _wo_id;
$function$


CREATE OR REPLACE FUNCTION public.work_orders_set_line_at_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.line_at_time IS NULL AND NEW.machine IS NOT NULL THEN
    SELECT
      CASE m.category
        WHEN 'line_fixed'  THEN m.fixed_line
        WHEN 'line_mobile' THEN COALESCE(m.current_line, NULLIF(m.line, ''))
        ELSE NULLIF(m.line, '')
      END
      INTO NEW.line_at_time
    FROM public.machines m
    WHERE m.name = NEW.machine
    LIMIT 1;
  END IF;
  RETURN NEW;
END $function$


CREATE OR REPLACE FUNCTION public.work_orders_set_line_at_time_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- New line-centric path: prefer line_id when provided
  IF NEW.line_id IS NOT NULL THEN
    SELECT name INTO NEW.line_at_time FROM public.lines WHERE id = NEW.line_id;
    RETURN NEW;
  END IF;

  -- Legacy path: derive from machine name (preserved for backward compat)
  IF NEW.line_at_time IS NULL AND NEW.machine IS NOT NULL AND NEW.machine <> '' THEN
    SELECT
      CASE m.category
        WHEN 'line_fixed'  THEN m.fixed_line
        WHEN 'line_mobile' THEN COALESCE(m.current_line, NULLIF(m.line, ''))
        ELSE NULLIF(m.line, '')
      END
      INTO NEW.line_at_time
    FROM public.machines m
    WHERE m.name = NEW.machine
    LIMIT 1;
  END IF;

  RETURN NEW;
END $function$


REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

DO $$ BEGIN
  CREATE POLICY "Admins can delete audit logs" ON public."audit_logs" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view audit logs" ON public."audit_logs" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view audit logs" ON public."audit_logs" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view checklist_responses" ON public."checklist_responses" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers and admins can insert checklist_responses" ON public."checklist_responses" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers and admins can update checklist_responses" ON public."checklist_responses" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can insert checklist_responses" ON public."checklist_responses" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update checklist_responses" ON public."checklist_responses" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage checklists" ON public."checklists" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view checklists" ON public."checklists" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage checklists" ON public."checklists" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can delete device_lines" ON public."device_lines" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can insert device_lines" ON public."device_lines" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view device_lines" ON public."device_lines" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can delete devices" ON public."devices" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can update devices" ON public."devices" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can view devices" ON public."devices" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can register device" ON public."devices" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((line_id IS NULL) AND (paired_by IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage downtime" ON public."downtime" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can create downtime" ON public."downtime" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can delete downtime" ON public."downtime" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can update downtime" ON public."downtime" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can view downtime" ON public."downtime" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage downtime" ON public."downtime" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Operators can view downtime" ON public."downtime" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Scoped downtime_events select" ON public."downtime_events" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (stopped_by = auth.uid()) OR (resumed_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = downtime_events.work_order_id) AND ((wo.operator_id = auth.uid()) OR (has_role(auth.uid(), 'operator'::app_role) AND (EXISTS ( SELECT 1
           FROM operator_line_accounts ola
          WHERE ((ola.user_id = auth.uid()) AND (wo.line_id = ANY (ola.line_ids))))))))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "dt_insert" ON public."downtime_events" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((stopped_by = auth.uid()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (has_role(auth.uid(), 'operator'::app_role) AND (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = downtime_events.work_order_id) AND ((wo.operator_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM operator_line_accounts ola
          WHERE ((ola.user_id = auth.uid()) AND (wo.line_id = ANY (ola.line_ids)))))))))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "dt_update" ON public."downtime_events" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (stopped_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = downtime_events.work_order_id) AND ((wo.operator_id = auth.uid()) OR (has_role(auth.uid(), 'operator'::app_role) AND (EXISTS ( SELECT 1
           FROM operator_line_accounts ola
          WHERE ((ola.user_id = auth.uid()) AND (wo.line_id = ANY (ola.line_ids)))))))))))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (stopped_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = downtime_events.work_order_id) AND ((wo.operator_id = auth.uid()) OR (has_role(auth.uid(), 'operator'::app_role) AND (EXISTS ( SELECT 1
           FROM operator_line_accounts ola
          WHERE ((ola.user_id = auth.uid()) AND (wo.line_id = ANY (ola.line_ids))))))))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage scores" ON public."engineer_scores" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers see own score" ON public."engineer_scores" AS PERMISSIVE FOR SELECT TO authenticated USING (((engineer_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage scores" ON public."engineer_scores" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view all scores" ON public."engineer_scores" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can create engineers" ON public."engineers" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can delete engineers" ON public."engineers" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update engineers" ON public."engineers" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can create engineers" ON public."engineers" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can delete engineers" ON public."engineers" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update engineers" ON public."engineers" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "No direct engineer reads for authenticated users" ON public."engineers" AS PERMISSIVE FOR SELECT TO authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admins/managers manage intouch map" ON public."intouch_machine_map" AS PERMISSIVE FOR ALL TO public USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "authenticated read intouch map" ON public."intouch_machine_map" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admin manage stop codes" ON public."intouch_stop_code_map" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers view stop codes" ON public."intouch_stop_code_map" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins view intouch logs" ON public."intouch_webhook_logs" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "line_leaders_read_auth" ON public."line_leaders" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "line_leaders_write_mgr" ON public."line_leaders" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage line_problem_descriptions" ON public."line_problem_descriptions" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view line_problem_descriptions" ON public."line_problem_descriptions" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage line_problem_descriptions" ON public."line_problem_descriptions" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage lines" ON public."lines" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view lines" ON public."lines" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage lines" ON public."lines" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage machine_assignments" ON public."machine_assignments" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view machine_assignments" ON public."machine_assignments" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view machine_events" ON public."machine_events" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers admins managers can insert machine_events" ON public."machine_events" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage location logs" ON public."machine_location_log" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can view location logs" ON public."machine_location_log" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage location logs" ON public."machine_location_log" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Operators can view location logs" ON public."machine_location_log" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage machines" ON public."machines" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view machines" ON public."machines" AS PERMISSIVE FOR SELECT TO public USING ((has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage machines" ON public."machines" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage mobile_assets" ON public."mobile_assets" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view mobile_assets" ON public."mobile_assets" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers manage mobile_assets" ON public."mobile_assets" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role and admins insert notifications" ON public."notifications" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own notifications" ON public."notifications" AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users view own notifications" ON public."notifications" AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers and owner view operator_line_accounts" ON public."operator_line_accounts" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can delete operator_line_accounts" ON public."operator_line_accounts" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can insert operator_line_accounts" ON public."operator_line_accounts" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins managers can update operator_line_accounts" ON public."operator_line_accounts" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers and admins can insert parts used" ON public."parts_used" AS PERMISSIVE FOR INSERT TO public WITH CHECK (((engineer_id = auth.uid()) AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can view own parts used" ON public."parts_used" AS PERMISSIVE FOR SELECT TO public USING (((engineer_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view all parts used" ON public."parts_used" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view pin lockout state" ON public."pin_attempts" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM executions deletable by admin/manager" ON public."pm_executions" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM executions insertable by all auth" ON public."pm_executions" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM executions viewable by all auth" ON public."pm_executions" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM schedules manageable by admin/manager" ON public."pm_schedules" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM schedules viewable by all auth" ON public."pm_schedules" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM tasks manageable by admin/manager" ON public."pm_tasks" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "PM tasks viewable by all auth" ON public."pm_tasks" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage problem_descriptions" ON public."problem_descriptions" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view problem_descriptions" ON public."problem_descriptions" AS PERMISSIVE FOR SELECT TO public USING ((has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage problem_descriptions" ON public."problem_descriptions" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage categories" ON public."product_categories" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can view categories" ON public."product_categories" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can manage categories" ON public."product_categories" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'manager'::app_role)) WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view production downtimes" ON public."production_downtimes" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can delete production downtimes" ON public."production_downtimes" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update production downtimes" ON public."production_downtimes" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'maintenance_manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Shop floor can insert production downtimes" ON public."production_downtimes" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'operator'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_items delete admin/manager" ON public."production_items" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_items insert admin/manager" ON public."production_items" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_items read all auth" ON public."production_items" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_items update admin/manager" ON public."production_items" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_sessions delete admin/manager" ON public."production_sessions" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_sessions insert admin/manager" ON public."production_sessions" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_sessions read all auth" ON public."production_sessions" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_sessions update admin/manager" ON public."production_sessions" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_targets read all auth" ON public."production_targets" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "production_targets write admin/manager" ON public."production_targets" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can delete products" ON public."products" AS PERMISSIVE FOR DELETE TO public USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can insert products" ON public."products" AS PERMISSIVE FOR INSERT TO public WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update products" ON public."products" AS PERMISSIVE FOR UPDATE TO public USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers and admins can view products" ON public."products" AS PERMISSIVE FOR SELECT TO public USING ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can insert products" ON public."products" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update products" ON public."products" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view products" ON public."products" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Allow profile insert during signup" ON public."profiles" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update non-admin profiles" ON public."profiles" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'manager'::app_role) AND (NOT has_role(id, 'admin'::app_role)))) WITH CHECK ((has_role(auth.uid(), 'manager'::app_role) AND (NOT has_role(id, 'admin'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view non-admin profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'manager'::app_role) AND (NOT has_role(id, 'admin'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own profile" ON public."profiles" AS PERMISSIVE FOR UPDATE TO authenticated USING (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view own profile" ON public."profiles" AS PERMISSIVE FOR SELECT TO authenticated USING (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_items_select_auth" ON public."purchase_order_items" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_items_write_admin_mgr" ON public."purchase_order_items" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_select_auth" ON public."purchase_orders" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "po_write_admin_mgr" ON public."purchase_orders" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins view all push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own push subscriptions" ON public."push_subscriptions" AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_action_types read all auth" ON public."quality_action_types" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_action_types write admin/manager" ON public."quality_action_types" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_actions delete admin/manager" ON public."quality_actions" AS PERMISSIVE FOR DELETE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_actions insert admin/manager" ON public."quality_actions" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_actions read all auth" ON public."quality_actions" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "quality_actions update admin/manager" ON public."quality_actions" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admin/manager write rag exclusions" ON public."rag_week_exclusions" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "auth read rag exclusions" ON public."rag_week_exclusions" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "rag_weekly_select_auth" ON public."rag_weekly_entries" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "rag_weekly_write_managers" ON public."rag_weekly_entries" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'maintenance_manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'maintenance_manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read shift settings" ON public."shift_report_settings" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins write shift settings" ON public."shift_report_settings" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sku_products read all auth" ON public."sku_products" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sku_products write admin/manager" ON public."sku_products" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "suppliers_select_auth" ON public."suppliers" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "suppliers_write_admin_mgr" ON public."suppliers" AS PERMISSIVE FOR ALL TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage system_settings" ON public."system_settings" AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Deny anon access to system_settings" ON public."system_settings" AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Deny non-admin authenticated access to system_settings" ON public."system_settings" AS RESTRICTIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admin/manager can read teams webhook logs" ON public."teams_webhook_logs" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can insert limited roles" ON public."user_roles" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'manager'::app_role) AND (user_id <> auth.uid()) AND (role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])) AND (NOT has_role(user_id, 'admin'::app_role)) AND (NOT has_role(user_id, 'manager'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update to limited roles" ON public."user_roles" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'manager'::app_role) AND (user_id <> auth.uid()) AND (role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])) AND (NOT has_role(user_id, 'admin'::app_role)) AND (NOT has_role(user_id, 'manager'::app_role)))) WITH CHECK ((has_role(auth.uid(), 'manager'::app_role) AND (user_id <> auth.uid()) AND (role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])) AND (NOT has_role(user_id, 'admin'::app_role)) AND (NOT has_role(user_id, 'manager'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view all roles" ON public."user_roles" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Only admins can delete roles" ON public."user_roles" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Only admins can insert roles" ON public."user_roles" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Only admins can update roles" ON public."user_roles" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view own role" ON public."user_roles" AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_episodes_insert_roles" ON public."wo_episodes" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'operator'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_episodes_select_scoped" ON public."wo_episodes" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = wo_episodes.work_order_id) AND ((wo.operator_id = auth.uid()) OR (wo.engineer_id = auth.uid()) OR (wo.locked_engineer_id = auth.uid())))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_episodes_update_roles" ON public."wo_episodes" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can view wo messages" ON public."wo_messages" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (user_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers admins managers can insert wo_messages" ON public."wo_messages" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view all wo_messages" ON public."wo_messages" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_pauses_insert_scoped" ON public."wo_pauses" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = wo_pauses.wo_id) AND (wo.locked_engineer_id = auth.uid()))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_pauses_select_scoped" ON public."wo_pauses" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = wo_pauses.wo_id) AND ((wo.locked_engineer_id = auth.uid()) OR (wo.operator_id = auth.uid())))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "wo_pauses_update_scoped" ON public."wo_pauses" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = wo_pauses.wo_id) AND (wo.locked_engineer_id = auth.uid())))))) WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = wo_pauses.wo_id) AND (wo.locked_engineer_id = auth.uid()))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers and admins can view wo_photos" ON public."wo_photos" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR (uploaded_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can insert wo_photos" ON public."wo_photos" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((uploaded_by = auth.uid()) AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view wo_photos" ON public."wo_photos" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can insert work_order_logs" ON public."work_order_logs" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'operator'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can insert work_order_logs" ON public."work_order_logs" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Scoped work_order_logs select" ON public."work_order_logs" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (EXISTS ( SELECT 1
   FROM work_orders wo
  WHERE ((wo.id = work_order_logs.work_order_id) AND ((wo.operator_id = auth.uid()) OR (wo.engineer_id = auth.uid()) OR (wo.locked_engineer_id = auth.uid())))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can create WOs" ON public."work_orders" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can delete WOs" ON public."work_orders" AS PERMISSIVE FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view all WOs" ON public."work_orders" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anplanner leaders can create WOs" ON public."work_orders" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((operator_id = auth.uid()) AND has_role(auth.uid(), 'operator'::app_role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anplanner leaders can view their own WOs" ON public."work_orders" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'operator'::app_role) AND (operator_id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can update locked or unlocked WOs" ON public."work_orders" AS PERMISSIVE FOR UPDATE TO authenticated USING ((has_role(auth.uid(), 'engineer'::app_role) AND ((locked_engineer_id IS NULL) OR (locked_engineer_id = auth.uid()) OR (auth.uid() = ANY (COALESCE(collaborator_ids, ARRAY[]::uuid[])))))) WITH CHECK ((has_role(auth.uid(), 'engineer'::app_role) AND ((locked_engineer_id IS NULL) OR (locked_engineer_id = auth.uid()) OR (auth.uid() = ANY (COALESCE(collaborator_ids, ARRAY[]::uuid[]))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Engineers can view WOs" ON public."work_orders" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'engineer'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can create WOs" ON public."work_orders" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can update WOs" ON public."work_orders" AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can view WOs" ON public."work_orders" AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'manager'::app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Operators create WOs on assigned line" ON public."work_orders" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((operator_id = auth.uid()) AND has_role(auth.uid(), 'operator'::app_role) AND (line_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM operator_line_accounts ola
  WHERE ((ola.user_id = auth.uid()) AND (work_orders.line_id = ANY (ola.line_ids)))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Operators strictly scoped to own line" ON public."work_orders" AS RESTRICTIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role) OR (NOT has_role(auth.uid(), 'operator'::app_role)) OR (operator_id = auth.uid()) OR ((line_id IS NOT NULL) AND (line_id = ANY (current_device_line_ids()))) OR ((line_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM operator_line_accounts ola
  WHERE ((ola.user_id = auth.uid()) AND (work_orders.line_id = ANY (ola.line_ids))))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Operators view own or assigned-line WOs" ON public."work_orders" AS PERMISSIVE FOR SELECT TO authenticated USING ((has_role(auth.uid(), 'operator'::app_role) AND (NOT has_role(auth.uid(), 'engineer'::app_role)) AND (NOT has_role(auth.uid(), 'manager'::app_role)) AND (NOT has_role(auth.uid(), 'admin'::app_role)) AND ((operator_id = auth.uid()) OR ((line_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM operator_line_accounts ola
  WHERE ((ola.user_id = auth.uid()) AND (work_orders.line_id = ANY (ola.line_ids)))))) OR ((line_id IS NOT NULL) AND (line_id = ANY (current_device_line_ids()))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machines" ADD CONSTRAINT "machines_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."mobile_assets" ADD CONSTRAINT "mobile_assets_current_line_id_fkey" FOREIGN KEY (current_line_id) REFERENCES lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."devices" ADD CONSTRAINT "devices_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."device_lines" ADD CONSTRAINT "device_lines_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."device_lines" ADD CONSTRAINT "device_lines_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."line_problem_descriptions" ADD CONSTRAINT "line_problem_descriptions_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."line_problem_descriptions" ADD CONSTRAINT "line_problem_descriptions_problem_description_id_fkey" FOREIGN KEY (problem_description_id) REFERENCES problem_descriptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."checklists" ADD CONSTRAINT "checklists_problem_description_id_fkey" FOREIGN KEY (problem_description_id) REFERENCES problem_descriptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."checklist_responses" ADD CONSTRAINT "checklist_responses_checklist_id_fkey" FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."checklist_responses" ADD CONSTRAINT "checklist_responses_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES engineers(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_closed_by_fkey" FOREIGN KEY (closed_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_mobile_asset_id_fkey" FOREIGN KEY (mobile_asset_id) REFERENCES mobile_assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_operator_id_fkey" FOREIGN KEY (operator_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_physical_line_id_fkey" FOREIGN KEY (physical_line_id) REFERENCES lines(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_recurrence_of_wo_id_fkey" FOREIGN KEY (recurrence_of_wo_id) REFERENCES work_orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."wo_episodes" ADD CONSTRAINT "wo_episodes_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."work_order_logs" ADD CONSTRAINT "work_order_logs_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."wo_photos" ADD CONSTRAINT "wo_photos_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."wo_photos" ADD CONSTRAINT "wo_photos_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."wo_pauses" ADD CONSTRAINT "wo_pauses_wo_id_fkey" FOREIGN KEY (wo_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."parts_used" ADD CONSTRAINT "parts_used_engineer_id_fkey" FOREIGN KEY (engineer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."parts_used" ADD CONSTRAINT "parts_used_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."parts_used" ADD CONSTRAINT "parts_used_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."downtime_events" ADD CONSTRAINT "downtime_events_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."downtime" ADD CONSTRAINT "downtime_reported_by_fkey" FOREIGN KEY (reported_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."downtime" ADD CONSTRAINT "downtime_work_order_id_fkey" FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machine_assignments" ADD CONSTRAINT "machine_assignments_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machine_assignments" ADD CONSTRAINT "machine_assignments_moved_by_fkey" FOREIGN KEY (moved_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machine_location_log" ADD CONSTRAINT "machine_location_log_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machine_location_log" ADD CONSTRAINT "machine_location_log_moved_by_fkey" FOREIGN KEY (moved_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."machine_events" ADD CONSTRAINT "machine_events_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."pm_tasks" ADD CONSTRAINT "pm_tasks_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES pm_schedules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."pm_executions" ADD CONSTRAINT "pm_executions_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES pm_schedules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_sessions" ADD CONSTRAINT "production_sessions_leader_id_fkey" FOREIGN KEY (leader_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_sessions" ADD CONSTRAINT "production_sessions_locked_by_fkey" FOREIGN KEY (locked_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_sessions" ADD CONSTRAINT "production_sessions_started_by_fkey" FOREIGN KEY (started_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_items" ADD CONSTRAINT "production_items_session_id_fkey" FOREIGN KEY (session_id) REFERENCES production_sessions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_items" ADD CONSTRAINT "production_items_sku_id_fkey" FOREIGN KEY (sku_id) REFERENCES sku_products(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_targets" ADD CONSTRAINT "production_targets_sku_id_fkey" FOREIGN KEY (sku_id) REFERENCES sku_products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."production_downtimes" ADD CONSTRAINT "production_downtimes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."quality_actions" ADD CONSTRAINT "quality_actions_action_type_id_fkey" FOREIGN KEY (action_type_id) REFERENCES quality_action_types(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."quality_actions" ADD CONSTRAINT "quality_actions_leader_id_fkey" FOREIGN KEY (leader_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."quality_actions" ADD CONSTRAINT "quality_actions_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."quality_actions" ADD CONSTRAINT "quality_actions_session_id_fkey" FOREIGN KEY (session_id) REFERENCES production_sessions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."rag_weekly_entries" ADD CONSTRAINT "rag_weekly_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public."intouch_machine_map" ADD CONSTRAINT "intouch_machine_map_line_id_fkey" FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_column OR datatype_mismatch THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc ON public.audit_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_created ON public.audit_logs USING btree (entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checklist_responses_checklist ON public.checklist_responses USING btree (checklist_id);

CREATE INDEX IF NOT EXISTS idx_checklist_responses_wo ON public.checklist_responses USING btree (work_order_id);

CREATE INDEX IF NOT EXISTS idx_checklists_problem ON public.checklists USING btree (problem_description_id);

CREATE INDEX IF NOT EXISTS idx_device_lines_device ON public.device_lines USING btree (device_id);

CREATE INDEX IF NOT EXISTS idx_device_lines_line ON public.device_lines USING btree (line_id);

CREATE INDEX IF NOT EXISTS idx_devices_line ON public.devices USING btree (line_id);

CREATE INDEX IF NOT EXISTS idx_devices_token ON public.devices USING btree (device_token);

CREATE INDEX IF NOT EXISTS idx_downtime_events_open ON public.downtime_events USING btree (work_order_id) WHERE (resumed_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_downtime_events_wo_stopped ON public.downtime_events USING btree (work_order_id, stopped_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_downtime_one_open_per_wo ON public.downtime_events USING btree (work_order_id) WHERE (resumed_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_downtime_open ON public.downtime_events USING btree (work_order_id) WHERE (resumed_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_downtime_wo ON public.downtime_events USING btree (work_order_id);

CREATE INDEX IF NOT EXISTS line_leaders_shift_idx ON public.line_leaders USING btree (shift) WHERE active;

CREATE INDEX IF NOT EXISTS idx_lpd_line_id ON public.line_problem_descriptions USING btree (line_id);

CREATE INDEX IF NOT EXISTS idx_lpd_problem_id ON public.line_problem_descriptions USING btree (problem_description_id);

CREATE INDEX IF NOT EXISTS idx_machine_assignments_active ON public.machine_assignments USING btree (machine_id) WHERE (assigned_until IS NULL);

CREATE INDEX IF NOT EXISTS idx_machine_events_created_at ON public.machine_events USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_machine_events_machine_created ON public.machine_events USING btree (machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_machine_events_machine_id ON public.machine_events USING btree (machine_id);

CREATE INDEX IF NOT EXISTS idx_machines_line_side ON public.machines USING btree (line_id, side);

CREATE INDEX IF NOT EXISTS idx_machines_name ON public.machines USING btree (name);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_pm_executions_schedule ON public.pm_executions USING btree (schedule_id, done_at DESC);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_machine ON public.pm_schedules USING btree (machine);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_next_due ON public.pm_schedules USING btree (next_due_at) WHERE (active = true);

CREATE INDEX IF NOT EXISTS idx_pm_tasks_schedule ON public.pm_tasks USING btree (schedule_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_problem_descriptions_active_name ON public.problem_descriptions USING btree (active, name);

CREATE INDEX IF NOT EXISTS idx_production_downtimes_date ON public.production_downtimes USING btree (occurred_date DESC);

CREATE INDEX IF NOT EXISTS idx_production_downtimes_line ON public.production_downtimes USING btree (line);

CREATE INDEX IF NOT EXISTS idx_production_items_session ON public.production_items USING btree (session_id);

CREATE INDEX IF NOT EXISTS production_items_session_idx ON public.production_items USING btree (session_id);

CREATE UNIQUE INDEX IF NOT EXISTS production_sessions_date_line_shift_uidx ON public.production_sessions USING btree (session_date, line, shift);

CREATE INDEX IF NOT EXISTS idx_products_low_stock ON public.products USING btree (quantity, min_stock) WHERE (quantity <= min_stock);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items USING btree (purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON public.purchase_orders USING btree (supplier_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_quality_actions_session ON public.quality_actions USING btree (session_id);

CREATE INDEX IF NOT EXISTS quality_actions_recorded_at_idx ON public.quality_actions USING btree (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_weekly_date ON public.rag_weekly_entries USING btree (entry_date);

CREATE INDEX IF NOT EXISTS idx_rag_weekly_line ON public.rag_weekly_entries USING btree (line);

CREATE INDEX IF NOT EXISTS sku_products_active_idx ON public.sku_products USING btree (active) WHERE (active = true);

CREATE INDEX IF NOT EXISTS teams_webhook_logs_created_at_idx ON public.teams_webhook_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_episodes_wo ON public.wo_episodes USING btree (work_order_id);

CREATE INDEX IF NOT EXISTS idx_wo_episodes_wo_episode ON public.wo_episodes USING btree (work_order_id, episode_number DESC);

CREATE INDEX IF NOT EXISTS idx_wo_pauses_wo_id ON public.wo_pauses USING btree (wo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_logs_unique_action ON public.work_order_logs USING btree (work_order_id, engineer_id, action) WHERE (action = ANY (ARRAY['accept'::text, 'start'::text, 'finish'::text, 'machine_back_to_work'::text, 'started'::text, 'finished'::text]));

CREATE INDEX IF NOT EXISTS idx_wo_engineer_status ON public.work_orders USING btree (engineer_id, status) WHERE (engineer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_wo_line_created ON public.work_orders USING btree (line_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_line_status_created ON public.work_orders USING btree (line_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_line_stopped_open ON public.work_orders USING btree (line_stopped, line_resumed_at) WHERE ((line_stopped = true) AND (line_resumed_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_wo_machine_created ON public.work_orders USING btree (machine, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_number ON public.work_orders USING btree (wo_number);

CREATE INDEX IF NOT EXISTS idx_wo_physical_line_status_created ON public.work_orders USING btree (physical_line_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_priority_status ON public.work_orders USING btree (priority, status);

CREATE INDEX IF NOT EXISTS idx_wo_recurrence ON public.work_orders USING btree (recurrence_of_wo_id) WHERE (recurrence_of_wo_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_wo_status_created ON public.work_orders USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON public.work_orders USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_orders_engineer ON public.work_orders USING btree (engineer_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_engineer_id ON public.work_orders USING btree (engineer_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_operator ON public.work_orders USING btree (operator_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_operator_id ON public.work_orders USING btree (operator_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_physical_line_id ON public.work_orders USING btree (physical_line_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders USING btree (status);

CREATE INDEX IF NOT EXISTS work_orders_intouch_open_idx ON public.work_orders USING btree (intouch_machine_id, status) WHERE (intouch_machine_id IS NOT NULL);

CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
SELECT work_order_id,
    count(*)::integer AS stop_count,
    COALESCE(sum(COALESCE(duration_minutes, (EXTRACT(epoch FROM now() - stopped_at) / 60::numeric)::integer)), 0::bigint)::integer AS total_minutes,
    bool_or(resumed_at IS NULL) AS has_open_stop
   FROM downtime_events
  GROUP BY work_order_id;;
GRANT SELECT ON public.v_wo_downtime_total TO authenticated;
GRANT ALL ON public.v_wo_downtime_total TO service_role;

CREATE OR REPLACE VIEW public.v_wo_metrics AS
SELECT id,
    wo_number,
    machine,
    priority,
    status,
    line_stopped_at,
    created_at,
    received_at AS accepted_at,
    arrived_at,
    started_at,
    finished_at,
    line_resumed_at,
    closed_at,
    EXTRACT(epoch FROM line_resumed_at - line_stopped_at)::integer AS line_downtime_sec,
    EXTRACT(epoch FROM created_at - line_stopped_at)::integer AS reporting_delay_sec,
    EXTRACT(epoch FROM received_at - created_at)::integer AS response_time_sec,
    EXTRACT(epoch FROM started_at - received_at)::integer AS travel_time_sec,
    EXTRACT(epoch FROM finished_at - started_at)::integer - wo_total_pause_seconds(id) AS active_repair_sec,
    EXTRACT(epoch FROM line_resumed_at - finished_at)::integer AS restart_delay_sec,
    EXTRACT(epoch FROM closed_at - line_resumed_at)::integer AS paperwork_delay_sec,
    EXTRACT(epoch FROM closed_at - created_at)::integer AS total_cycle_sec
   FROM work_orders wo;;
GRANT SELECT ON public.v_wo_metrics TO authenticated;
GRANT ALL ON public.v_wo_metrics TO service_role;

CREATE OR REPLACE VIEW public.profiles_safe AS
SELECT id,
    name,
    email,
    shift,
    active,
    last_seen_at,
    ui_preferences,
    created_at,
    updated_at
   FROM profiles;;
GRANT SELECT ON public.profiles_safe TO authenticated;
GRANT ALL ON public.profiles_safe TO service_role;

CREATE OR REPLACE VIEW public.engineers_safe AS
SELECT id,
    name,
    is_active,
    created_at
   FROM engineers;;
GRANT SELECT ON public.engineers_safe TO authenticated;
GRANT ALL ON public.engineers_safe TO service_role;

DROP TRIGGER IF EXISTS "validate_downtime_category_trigger" ON public."downtime";
CREATE TRIGGER "validate_downtime_category_trigger" BEFORE INSERT ON public."downtime" FOR EACH ROW EXECUTE FUNCTION validate_downtime_category();

DROP TRIGGER IF EXISTS "validate_downtime_category_trigger" ON public."downtime";
CREATE TRIGGER "validate_downtime_category_trigger" BEFORE UPDATE ON public."downtime" FOR EACH ROW EXECUTE FUNCTION validate_downtime_category();

DROP TRIGGER IF EXISTS "trg_downtime_sync" ON public."downtime_events";
CREATE TRIGGER "trg_downtime_sync" AFTER DELETE ON public."downtime_events" FOR EACH ROW EXECUTE FUNCTION sync_wo_line_status();

DROP TRIGGER IF EXISTS "trg_downtime_sync" ON public."downtime_events";
CREATE TRIGGER "trg_downtime_sync" AFTER INSERT ON public."downtime_events" FOR EACH ROW EXECUTE FUNCTION sync_wo_line_status();

DROP TRIGGER IF EXISTS "trg_downtime_sync" ON public."downtime_events";
CREATE TRIGGER "trg_downtime_sync" AFTER UPDATE ON public."downtime_events" FOR EACH ROW EXECUTE FUNCTION sync_wo_line_status();

DROP TRIGGER IF EXISTS "guard_engineer_pin_hash_trigger" ON public."engineers";
CREATE TRIGGER "guard_engineer_pin_hash_trigger" BEFORE INSERT ON public."engineers" FOR EACH ROW EXECUTE FUNCTION guard_engineer_pin_hash();

DROP TRIGGER IF EXISTS "guard_engineer_pin_hash_trigger" ON public."engineers";
CREATE TRIGGER "guard_engineer_pin_hash_trigger" BEFORE UPDATE ON public."engineers" FOR EACH ROW EXECUTE FUNCTION guard_engineer_pin_hash();

DROP TRIGGER IF EXISTS "update_intouch_stop_code_map_updated_at" ON public."intouch_stop_code_map";
CREATE TRIGGER "update_intouch_stop_code_map_updated_at" BEFORE UPDATE ON public."intouch_stop_code_map" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "line_leaders_set_updated_at" ON public."line_leaders";
CREATE TRIGGER "line_leaders_set_updated_at" BEFORE UPDATE ON public."line_leaders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "trg_validate_machine_side" ON public."machines";
CREATE TRIGGER "trg_validate_machine_side" BEFORE INSERT ON public."machines" FOR EACH ROW EXECUTE FUNCTION validate_machine_side();

DROP TRIGGER IF EXISTS "trg_validate_machine_side" ON public."machines";
CREATE TRIGGER "trg_validate_machine_side" BEFORE UPDATE ON public."machines" FOR EACH ROW EXECUTE FUNCTION validate_machine_side();

DROP TRIGGER IF EXISTS "operator_line_accounts_updated_at" ON public."operator_line_accounts";
CREATE TRIGGER "operator_line_accounts_updated_at" BEFORE UPDATE ON public."operator_line_accounts" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_reduce_stock_on_parts_used" ON public."parts_used";
CREATE TRIGGER "trg_reduce_stock_on_parts_used" AFTER INSERT ON public."parts_used" FOR EACH ROW EXECUTE FUNCTION reduce_stock_on_parts_used();

DROP TRIGGER IF EXISTS "trg_validate_stock" ON public."parts_used";
CREATE TRIGGER "trg_validate_stock" BEFORE INSERT ON public."parts_used" FOR EACH ROW EXECUTE FUNCTION validate_stock_availability();

DROP TRIGGER IF EXISTS "trg_pm_executions_apply" ON public."pm_executions";
CREATE TRIGGER "trg_pm_executions_apply" AFTER INSERT ON public."pm_executions" FOR EACH ROW EXECUTE FUNCTION pm_apply_execution();

DROP TRIGGER IF EXISTS "trg_pm_schedules_recompute_next_due" ON public."pm_schedules";
CREATE TRIGGER "trg_pm_schedules_recompute_next_due" BEFORE INSERT ON public."pm_schedules" FOR EACH ROW EXECUTE FUNCTION pm_recompute_next_due();

DROP TRIGGER IF EXISTS "trg_pm_schedules_recompute_next_due" ON public."pm_schedules";
CREATE TRIGGER "trg_pm_schedules_recompute_next_due" BEFORE UPDATE ON public."pm_schedules" FOR EACH ROW EXECUTE FUNCTION pm_recompute_next_due();

DROP TRIGGER IF EXISTS "set_production_downtimes_updated_at" ON public."production_downtimes";
CREATE TRIGGER "set_production_downtimes_updated_at" BEFORE UPDATE ON public."production_downtimes" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_production_items_updated" ON public."production_items";
CREATE TRIGGER "trg_production_items_updated" BEFORE UPDATE ON public."production_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "trg_sync_rag_actual" ON public."production_items";
CREATE TRIGGER "trg_sync_rag_actual" AFTER DELETE ON public."production_items" FOR EACH ROW EXECUTE FUNCTION sync_rag_actual_from_items();

DROP TRIGGER IF EXISTS "trg_sync_rag_actual" ON public."production_items";
CREATE TRIGGER "trg_sync_rag_actual" AFTER INSERT ON public."production_items" FOR EACH ROW EXECUTE FUNCTION sync_rag_actual_from_items();

DROP TRIGGER IF EXISTS "trg_sync_rag_actual" ON public."production_items";
CREATE TRIGGER "trg_sync_rag_actual" AFTER UPDATE ON public."production_items" FOR EACH ROW EXECUTE FUNCTION sync_rag_actual_from_items();

DROP TRIGGER IF EXISTS "trg_production_sessions_updated" ON public."production_sessions";
CREATE TRIGGER "trg_production_sessions_updated" BEFORE UPDATE ON public."production_sessions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "trg_production_targets_updated" ON public."production_targets";
CREATE TRIGGER "trg_production_targets_updated" BEFORE UPDATE ON public."production_targets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "update_products_updated_at" ON public."products";
CREATE TRIGGER "update_products_updated_at" BEFORE UPDATE ON public."products" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "update_profiles_updated_at" ON public."profiles";
CREATE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON public."profiles" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "purchase_orders_updated_at" ON public."purchase_orders";
CREATE TRIGGER "purchase_orders_updated_at" BEFORE UPDATE ON public."purchase_orders" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_quality_action_types_updated" ON public."quality_action_types";
CREATE TRIGGER "trg_quality_action_types_updated" BEFORE UPDATE ON public."quality_action_types" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "trg_quality_actions_updated" ON public."quality_actions";
CREATE TRIGGER "trg_quality_actions_updated" BEFORE UPDATE ON public."quality_actions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "trg_rag_weekly_updated_at" ON public."rag_weekly_entries";
CREATE TRIGGER "trg_rag_weekly_updated_at" BEFORE UPDATE ON public."rag_weekly_entries" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_sku_products_updated" ON public."sku_products";
CREATE TRIGGER "trg_sku_products_updated" BEFORE UPDATE ON public."sku_products" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS "suppliers_updated_at" ON public."suppliers";
CREATE TRIGGER "suppliers_updated_at" BEFORE UPDATE ON public."suppliers" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "trg_recalculate_health" ON public."work_orders";
CREATE TRIGGER "trg_recalculate_health" AFTER INSERT ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION recalculate_health_scores();

DROP TRIGGER IF EXISTS "trg_recalculate_health" ON public."work_orders";
CREATE TRIGGER "trg_recalculate_health" AFTER UPDATE ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION recalculate_health_scores();

DROP TRIGGER IF EXISTS "trg_sync_machine_status" ON public."work_orders";
CREATE TRIGGER "trg_sync_machine_status" AFTER UPDATE ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION sync_machine_status_from_wo();

DROP TRIGGER IF EXISTS "trg_update_engineer_score" ON public."work_orders";
CREATE TRIGGER "trg_update_engineer_score" AFTER UPDATE ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION update_engineer_score();

DROP TRIGGER IF EXISTS "trg_wo_set_line_at_time" ON public."work_orders";
CREATE TRIGGER "trg_wo_set_line_at_time" BEFORE INSERT ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION work_orders_set_line_at_time_v2();

DROP TRIGGER IF EXISTS "trg_wo_set_line_at_time" ON public."work_orders";
CREATE TRIGGER "trg_wo_set_line_at_time" BEFORE UPDATE ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION work_orders_set_line_at_time_v2();

DROP TRIGGER IF EXISTS "trg_work_orders_set_line_at_time" ON public."work_orders";
CREATE TRIGGER "trg_work_orders_set_line_at_time" BEFORE INSERT ON public."work_orders" FOR EACH ROW EXECUTE FUNCTION work_orders_set_line_at_time();


INSERT INTO public.lines (name)
SELECT v.name FROM (VALUES ('Line 1'),('Line 2'),('Line 3'),('Line 4'),('Line 5'),('Line 6'),('Line 7'),('Capsules'),('Gel')) AS v(name)
WHERE to_regclass('public.lines') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.system_settings (intouch_sync_enabled)
SELECT false
WHERE to_regclass('public.system_settings') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.system_settings);

