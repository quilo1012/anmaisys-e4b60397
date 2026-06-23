export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          user_id: string | null
          user_name: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          user_id?: string | null
          user_name: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_id?: string | null
          user_name?: string
        }
        Relationships: []
      }
      checklist_responses: {
        Row: {
          checklist_id: string
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          work_order_id: string
        }
        Insert: {
          checklist_id: string
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          work_order_id: string
        }
        Update: {
          checklist_id?: string
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "engineers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "engineers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          created_at: string
          description: string
          id: string
          is_required: boolean
          problem_description_id: string
          type: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_required?: boolean
          problem_description_id: string
          type?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_required?: boolean
          problem_description_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_problem_description_id_fkey"
            columns: ["problem_description_id"]
            isOneToOne: false
            referencedRelation: "problem_descriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      device_lines: {
        Row: {
          created_at: string
          device_id: string
          id: string
          line_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          line_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_lines_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_lines_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          device_token: string
          id: string
          label: string | null
          last_seen_at: string | null
          line_id: string | null
          paired_at: string | null
          paired_by: string | null
        }
        Insert: {
          created_at?: string
          device_token: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          line_id?: string | null
          paired_at?: string | null
          paired_by?: string | null
        }
        Update: {
          created_at?: string
          device_token?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          line_id?: string | null
          paired_at?: string | null
          paired_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime: {
        Row: {
          category: string
          created_at: string
          ended_at: string | null
          id: string
          line: string
          machine: string | null
          notes: string | null
          reason: string
          reported_by: string | null
          started_at: string
          work_order_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          ended_at?: string | null
          id?: string
          line: string
          machine?: string | null
          notes?: string | null
          reason: string
          reported_by?: string | null
          started_at?: string
          work_order_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          line?: string
          machine?: string | null
          notes?: string | null
          reason?: string
          reported_by?: string | null
          started_at?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downtime_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_events: {
        Row: {
          created_at: string
          duration_minutes: number | null
          episode_number: number
          id: string
          is_recurrence: boolean
          resumed_at: string | null
          resumed_by: string | null
          resumed_by_name: string | null
          resumed_note: string | null
          stopped_at: string
          stopped_by: string | null
          stopped_by_name: string | null
          stopped_reason: string | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          episode_number?: number
          id?: string
          is_recurrence?: boolean
          resumed_at?: string | null
          resumed_by?: string | null
          resumed_by_name?: string | null
          resumed_note?: string | null
          stopped_at: string
          stopped_by?: string | null
          stopped_by_name?: string | null
          stopped_reason?: string | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          episode_number?: number
          id?: string
          is_recurrence?: boolean
          resumed_at?: string | null
          resumed_by?: string | null
          resumed_by_name?: string | null
          resumed_note?: string | null
          stopped_at?: string
          stopped_by?: string | null
          stopped_by_name?: string | null
          stopped_reason?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "downtime_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      engineer_scores: {
        Row: {
          engineer_id: string
          id: string
          score: number
          updated_at: string
        }
        Insert: {
          engineer_id: string
          id?: string
          score?: number
          updated_at?: string
        }
        Update: {
          engineer_id?: string
          id?: string
          score?: number
          updated_at?: string
        }
        Relationships: []
      }
      engineers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          pin_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          pin_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          pin_hash?: string
        }
        Relationships: []
      }
      line_problem_descriptions: {
        Row: {
          created_at: string
          id: string
          line_id: string
          problem_description_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_id: string
          problem_description_id: string
        }
        Update: {
          created_at?: string
          id?: string
          line_id?: string
          problem_description_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_problem_descriptions_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_problem_descriptions_problem_description_id_fkey"
            columns: ["problem_description_id"]
            isOneToOne: false
            referencedRelation: "problem_descriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          created_at: string
          display_order: number
          has_sides: boolean
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          has_sides?: boolean
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          display_order?: number
          has_sides?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      machine_assignments: {
        Row: {
          assigned_from: string
          assigned_line: string
          assigned_until: string | null
          id: string
          machine_id: string
          moved_by: string | null
          notes: string | null
        }
        Insert: {
          assigned_from?: string
          assigned_line: string
          assigned_until?: string | null
          id?: string
          machine_id: string
          moved_by?: string | null
          notes?: string | null
        }
        Update: {
          assigned_from?: string
          assigned_line?: string
          assigned_until?: string | null
          id?: string
          machine_id?: string
          moved_by?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_assignments_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_events: {
        Row: {
          action_taken: string | null
          created_at: string
          engineer_id: string | null
          engineer_name: string | null
          event_type: string
          id: string
          machine_id: string | null
          part_used: string | null
          problem_description: string | null
          work_order_id: string | null
        }
        Insert: {
          action_taken?: string | null
          created_at?: string
          engineer_id?: string | null
          engineer_name?: string | null
          event_type?: string
          id?: string
          machine_id?: string | null
          part_used?: string | null
          problem_description?: string | null
          work_order_id?: string | null
        }
        Update: {
          action_taken?: string | null
          created_at?: string
          engineer_id?: string | null
          engineer_name?: string | null
          event_type?: string
          id?: string
          machine_id?: string | null
          part_used?: string | null
          problem_description?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_events_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_location_log: {
        Row: {
          created_at: string
          from_location: string
          id: string
          machine_id: string
          moved_by: string | null
          to_location: string
        }
        Insert: {
          created_at?: string
          from_location?: string
          id?: string
          machine_id: string
          moved_by?: string | null
          to_location: string
        }
        Update: {
          created_at?: string
          from_location?: string
          id?: string
          machine_id?: string
          moved_by?: string | null
          to_location?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_location_log_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          category: Database["public"]["Enums"]["machine_category"] | null
          code: string | null
          created_at: string
          current_line: string | null
          current_location: string
          fixed_line: string | null
          health_score: number
          id: string
          last_maintenance_date: string | null
          line: string | null
          line_id: string | null
          machine_type: string
          name: string
          sector: string | null
          side: string
          status: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["machine_category"] | null
          code?: string | null
          created_at?: string
          current_line?: string | null
          current_location?: string
          fixed_line?: string | null
          health_score?: number
          id?: string
          last_maintenance_date?: string | null
          line?: string | null
          line_id?: string | null
          machine_type?: string
          name: string
          sector?: string | null
          side?: string
          status?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["machine_category"] | null
          code?: string | null
          created_at?: string
          current_line?: string | null
          current_location?: string
          fixed_line?: string | null
          health_score?: number
          id?: string
          last_maintenance_date?: string | null
          line?: string | null
          line_id?: string | null
          machine_type?: string
          name?: string
          sector?: string | null
          side?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_assets: {
        Row: {
          active: boolean
          asset_number: number
          asset_type: Database["public"]["Enums"]["mobile_asset_type"]
          created_at: string
          current_line_id: string | null
          id: string
        }
        Insert: {
          active?: boolean
          asset_number: number
          asset_type: Database["public"]["Enums"]["mobile_asset_type"]
          created_at?: string
          current_line_id?: string | null
          id?: string
        }
        Update: {
          active?: boolean
          asset_number?: number
          asset_type?: Database["public"]["Enums"]["mobile_asset_type"]
          created_at?: string
          current_line_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobile_assets_current_line_id_fkey"
            columns: ["current_line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          created_at: string
          id: string
          priority: string
          read_at: string | null
          title: string
          user_id: string
          wo_id: string | null
        }
        Insert: {
          action_url?: string | null
          body?: string
          created_at?: string
          id?: string
          priority?: string
          read_at?: string | null
          title: string
          user_id: string
          wo_id?: string | null
        }
        Update: {
          action_url?: string | null
          body?: string
          created_at?: string
          id?: string
          priority?: string
          read_at?: string | null
          title?: string
          user_id?: string
          wo_id?: string | null
        }
        Relationships: []
      }
      operator_line_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          label: string
          line_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          label: string
          line_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          label?: string
          line_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      parts_used: {
        Row: {
          created_at: string
          engineer_id: string
          engineer_name: string
          id: string
          product_id: string
          quantity: number
          work_order_id: string
        }
        Insert: {
          created_at?: string
          engineer_id: string
          engineer_name?: string
          id?: string
          product_id: string
          quantity: number
          work_order_id: string
        }
        Update: {
          created_at?: string
          engineer_id?: string
          engineer_name?: string
          id?: string
          product_id?: string
          quantity?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parts_used_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_used_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_used_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_used_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_used_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_descriptions: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          severity: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          severity?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          severity?: string | null
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string
          code: string
          created_at: string
          id: string
          line: string
          min_stock: number
          name: string
          price: number
          quantity: number
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          id?: string
          line?: string
          min_stock?: number
          name: string
          price?: number
          quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          id?: string
          line?: string
          min_stock?: number
          name?: string
          price?: number
          quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          labor_rate: number
          last_seen_at: string | null
          name: string
          shift: string | null
          ui_preferences: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id: string
          labor_rate?: number
          last_seen_at?: string | null
          name: string
          shift?: string | null
          ui_preferences?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          labor_rate?: number
          last_seen_at?: string | null
          name?: string
          shift?: string | null
          ui_preferences?: Json
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          admin_pin: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          admin_pin?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          admin_pin?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wo_episodes: {
        Row: {
          accepted_at: string | null
          arrived_at: string | null
          episode_number: number
          finish_engineer_id: string | null
          finish_pin_verified: boolean
          finished_at: string | null
          id: string
          notes: string | null
          reopen_reason: string | null
          reopened_by: string | null
          started_at: string
          started_work_at: string | null
          work_order_id: string
        }
        Insert: {
          accepted_at?: string | null
          arrived_at?: string | null
          episode_number: number
          finish_engineer_id?: string | null
          finish_pin_verified?: boolean
          finished_at?: string | null
          id?: string
          notes?: string | null
          reopen_reason?: string | null
          reopened_by?: string | null
          started_at?: string
          started_work_at?: string | null
          work_order_id: string
        }
        Update: {
          accepted_at?: string | null
          arrived_at?: string | null
          episode_number?: number
          finish_engineer_id?: string | null
          finish_pin_verified?: boolean
          finished_at?: string | null
          id?: string
          notes?: string | null
          reopen_reason?: string | null
          reopened_by?: string | null
          started_at?: string
          started_work_at?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wo_episodes_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_episodes_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      wo_messages: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          message: string
          user_id: string
          user_name: string
          work_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          user_id: string
          user_name: string
          work_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          user_id?: string
          user_name?: string
          work_order_id?: string
        }
        Relationships: []
      }
      wo_pauses: {
        Row: {
          created_at: string
          id: string
          paused_at: string
          reason: string | null
          resumed_at: string | null
          wo_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          paused_at: string
          reason?: string | null
          resumed_at?: string | null
          wo_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          paused_at?: string
          reason?: string | null
          resumed_at?: string | null
          wo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wo_pauses_wo_id_fkey"
            columns: ["wo_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_pauses_wo_id_fkey"
            columns: ["wo_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      wo_photos: {
        Row: {
          created_at: string
          id: string
          photo_type: string
          storage_path: string
          uploaded_by: string
          work_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_type: string
          storage_path: string
          uploaded_by: string
          work_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_type?: string
          storage_path?: string
          uploaded_by?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wo_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_photos_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_photos_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_logs: {
        Row: {
          action: string
          created_at: string
          engineer_id: string
          engineer_name: string
          id: string
          work_order_id: string
        }
        Insert: {
          action: string
          created_at?: string
          engineer_id: string
          engineer_name: string
          id?: string
          work_order_id: string
        }
        Update: {
          action?: string
          created_at?: string
          engineer_id?: string
          engineer_name?: string
          id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_logs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_logs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          arrived_at: string | null
          checklist_completed: boolean
          closed_at: string | null
          closed_by: string | null
          collaborator_ids: string[]
          collaborator_names: string[]
          completed_at: string | null
          created_at: string
          current_episode: number
          description: string
          engineer_id: string | null
          engineer_name: string | null
          engineer_notified_acknowledged_at: string | null
          finished_at: string | null
          id: string
          line_at_time: string | null
          line_id: string | null
          line_resumed_at: string | null
          line_resumed_by: string | null
          line_stopped: boolean
          line_stopped_at: string | null
          line_stopped_by: string | null
          locked_at: string | null
          locked_engineer_id: string | null
          machine: string | null
          mobile_asset_id: string | null
          notes: string | null
          notified_engineers: string[] | null
          operator_id: string
          operator_signature_name: string | null
          pause_reason: string
          paused_at: string | null
          physical_line_id: string | null
          priority: string
          received_at: string | null
          recurrence_of_wo_id: string | null
          reopen_count: number
          requester_name: string
          signed_by_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes: number
          wo_number: number
        }
        Insert: {
          arrived_at?: string | null
          checklist_completed?: boolean
          closed_at?: string | null
          closed_by?: string | null
          collaborator_ids?: string[]
          collaborator_names?: string[]
          completed_at?: string | null
          created_at?: string
          current_episode?: number
          description: string
          engineer_id?: string | null
          engineer_name?: string | null
          engineer_notified_acknowledged_at?: string | null
          finished_at?: string | null
          id?: string
          line_at_time?: string | null
          line_id?: string | null
          line_resumed_at?: string | null
          line_resumed_by?: string | null
          line_stopped?: boolean
          line_stopped_at?: string | null
          line_stopped_by?: string | null
          locked_at?: string | null
          locked_engineer_id?: string | null
          machine?: string | null
          mobile_asset_id?: string | null
          notes?: string | null
          notified_engineers?: string[] | null
          operator_id: string
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          physical_line_id?: string | null
          priority?: string
          received_at?: string | null
          recurrence_of_wo_id?: string | null
          reopen_count?: number
          requester_name: string
          signed_by_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes?: number
          wo_number?: number
        }
        Update: {
          arrived_at?: string | null
          checklist_completed?: boolean
          closed_at?: string | null
          closed_by?: string | null
          collaborator_ids?: string[]
          collaborator_names?: string[]
          completed_at?: string | null
          created_at?: string
          current_episode?: number
          description?: string
          engineer_id?: string | null
          engineer_name?: string | null
          engineer_notified_acknowledged_at?: string | null
          finished_at?: string | null
          id?: string
          line_at_time?: string | null
          line_id?: string | null
          line_resumed_at?: string | null
          line_resumed_by?: string | null
          line_stopped?: boolean
          line_stopped_at?: string | null
          line_stopped_by?: string | null
          locked_at?: string | null
          locked_engineer_id?: string | null
          machine?: string | null
          mobile_asset_id?: string | null
          notes?: string | null
          notified_engineers?: string[] | null
          operator_id?: string
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          physical_line_id?: string | null
          priority?: string
          received_at?: string | null
          recurrence_of_wo_id?: string | null
          reopen_count?: number
          requester_name?: string
          signed_by_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes?: number
          wo_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_mobile_asset_id_fkey"
            columns: ["mobile_asset_id"]
            isOneToOne: false
            referencedRelation: "mobile_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_physical_line_id_fkey"
            columns: ["physical_line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_recurrence_of_wo_id_fkey"
            columns: ["recurrence_of_wo_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_recurrence_of_wo_id_fkey"
            columns: ["recurrence_of_wo_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      engineers_safe: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
        }
        Relationships: []
      }
      profiles_safe: {
        Row: {
          active: boolean | null
          created_at: string | null
          email: string | null
          id: string | null
          last_seen_at: string | null
          name: string | null
          shift: string | null
          ui_preferences: Json | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_seen_at?: string | null
          name?: string | null
          shift?: string | null
          ui_preferences?: Json | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_seen_at?: string | null
          name?: string | null
          shift?: string | null
          ui_preferences?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_wo_downtime_total: {
        Row: {
          has_open_stop: boolean | null
          stop_count: number | null
          total_minutes: number | null
          work_order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downtime_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_wo_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_wo_metrics: {
        Row: {
          accepted_at: string | null
          active_repair_sec: number | null
          arrived_at: string | null
          closed_at: string | null
          created_at: string | null
          finished_at: string | null
          id: string | null
          line_downtime_sec: number | null
          line_resumed_at: string | null
          line_stopped_at: string | null
          machine: string | null
          paperwork_delay_sec: number | null
          priority: string | null
          reporting_delay_sec: number | null
          response_time_sec: number | null
          restart_delay_sec: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["wo_status"] | null
          total_cycle_sec: number | null
          travel_time_sec: number | null
          wo_number: number | null
        }
        Insert: {
          accepted_at?: string | null
          active_repair_sec?: never
          arrived_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          finished_at?: string | null
          id?: string | null
          line_downtime_sec?: never
          line_resumed_at?: string | null
          line_stopped_at?: string | null
          machine?: string | null
          paperwork_delay_sec?: never
          priority?: string | null
          reporting_delay_sec?: never
          response_time_sec?: never
          restart_delay_sec?: never
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"] | null
          total_cycle_sec?: never
          travel_time_sec?: never
          wo_number?: number | null
        }
        Update: {
          accepted_at?: string | null
          active_repair_sec?: never
          arrived_at?: string | null
          closed_at?: string | null
          created_at?: string | null
          finished_at?: string | null
          id?: string | null
          line_downtime_sec?: never
          line_resumed_at?: string | null
          line_stopped_at?: string | null
          machine?: string | null
          paperwork_delay_sec?: never
          priority?: string | null
          reporting_delay_sec?: never
          response_time_sec?: never
          restart_delay_sec?: never
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"] | null
          total_cycle_sec?: never
          travel_time_sec?: never
          wo_number?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_wo_with_pin: {
        Args: { _pin: string; _wo_id: string }
        Returns: Json
      }
      acknowledge_wo_alert: { Args: { _wo_id: string }; Returns: undefined }
      add_wo_collaborator: {
        Args: { _pin: string; _wo_id: string }
        Returns: Json
      }
      admin_list_device_tokens: {
        Args: never
        Returns: {
          device_token: string
          id: string
          label: string
          last_seen_at: string
          line_id: string
          paired_at: string
        }[]
      }
      current_device_line: { Args: never; Returns: string }
      current_device_line_ids: { Args: never; Returns: string[] }
      current_device_token: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      finish_wo_with_pin: {
        Args: { _pin: string; _signed_by_name?: string; _wo_id: string }
        Returns: Json
      }
      get_device_line: { Args: { _token: string }; Returns: string }
      get_own_labor_rate: { Args: never; Returns: number }
      get_profile_labor_rate: { Args: { _user_id: string }; Returns: number }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_active_profile_names: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      list_engineer_names: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      list_operator_account_user_ids: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      list_profile_labor_rates: {
        Args: never
        Returns: {
          id: string
          labor_rate: number
          name: string
        }[]
      }
      list_tablet_accounts_public: {
        Args: never
        Returns: {
          id: string
          label: string
          line_ids: string[]
        }[]
      }
      log_audit_event: {
        Args: {
          _action: string
          _details?: Json
          _entity_id?: string
          _entity_type: string
        }
        Returns: undefined
      }
      log_wo_retrigger: {
        Args: { _reason: string; _wo_id: string }
        Returns: Json
      }
      move_machine_to_line: {
        Args: { _machine_id: string; _new_line: string; _notes?: string }
        Returns: undefined
      }
      pair_device: {
        Args: { _label?: string; _line_id: string; _token: string }
        Returns: undefined
      }
      pair_device_lines: {
        Args: { _label?: string; _line_ids: string[]; _token: string }
        Returns: undefined
      }
      reopen_wo_as_recurrence: {
        Args: { _reason: string; _wo_id: string }
        Returns: Json
      }
      reopen_wo_recurrence: {
        Args: { _reason: string; _wo_id: string }
        Returns: Json
      }
      set_admin_pin: { Args: { _new_pin: string }; Returns: undefined }
      set_engineer_pin: {
        Args: { _new_pin: string; _user_id: string }
        Returns: undefined
      }
      set_engineer_pin_standalone: {
        Args: { _engineer_id: string; _new_pin: string }
        Returns: undefined
      }
      touch_device: { Args: { _token: string }; Returns: undefined }
      unpair_device: { Args: { _device_id: string }; Returns: undefined }
      verify_admin_pin: { Args: { _pin: string }; Returns: boolean }
      verify_engineer_pin: {
        Args: { _pin: string; _user_id: string }
        Returns: boolean
      }
      verify_pin_by_code: {
        Args: { _pin: string }
        Returns: {
          engineer_id: string
          engineer_name: string
        }[]
      }
      wo_total_pause_seconds: { Args: { _wo_id: string }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "engineer" | "operator" | "manager" | "viewer"
      machine_category: "line_fixed" | "line_mobile" | "support"
      mobile_asset_type: "printer" | "bag_sealer"
      wo_status:
        | "open"
        | "in_progress"
        | "completed"
        | "force_closed"
        | "received"
        | "arrived"
        | "finished"
        | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "engineer", "operator", "manager", "viewer"],
      machine_category: ["line_fixed", "line_mobile", "support"],
      mobile_asset_type: ["printer", "bag_sealer"],
      wo_status: [
        "open",
        "in_progress",
        "completed",
        "force_closed",
        "received",
        "arrived",
        "finished",
        "closed",
      ],
    },
  },
} as const
