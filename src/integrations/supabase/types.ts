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
      _bkp_blender_before_clear: {
        Row: {
          blender_number: number | null
          created_at: string | null
          entered_by: string | null
          id: string | null
          production_item_id: string | null
          quantity: number | null
          session_id: string | null
          updated_at: string | null
        }
        Insert: {
          blender_number?: number | null
          created_at?: string | null
          entered_by?: string | null
          id?: string | null
          production_item_id?: string | null
          quantity?: number | null
          session_id?: string | null
          updated_at?: string | null
        }
        Update: {
          blender_number?: number | null
          created_at?: string | null
          entered_by?: string | null
          id?: string | null
          production_item_id?: string | null
          quantity?: number | null
          session_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_prod_items_before_clear: {
        Row: {
          actual_qty: number | null
          blender_ref: string | null
          created_at: string | null
          display_order: number | null
          id: string | null
          intouch_qty: number | null
          notes: string | null
          planned_qty: number | null
          scrap_qty: number | null
          session_id: string | null
          sku_code_text: string | null
          sku_id: string | null
          target_manual_at: string | null
          target_manual_by: string | null
          target_qty: number | null
          tickets_unit: string | null
          updated_at: string | null
        }
        Insert: {
          actual_qty?: number | null
          blender_ref?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number | null
          scrap_qty?: number | null
          session_id?: string | null
          sku_code_text?: string | null
          sku_id?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_qty?: number | null
          blender_ref?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number | null
          scrap_qty?: number | null
          session_id?: string | null
          sku_code_text?: string | null
          sku_id?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_production_items_20260722: {
        Row: {
          actual_qty: number | null
          blender_ref: string | null
          created_at: string | null
          display_order: number | null
          id: string | null
          intouch_qty: number | null
          notes: string | null
          planned_qty: number | null
          scrap_qty: number | null
          session_id: string | null
          sku_id: string | null
          target_manual_at: string | null
          target_manual_by: string | null
          target_qty: number | null
          tickets_unit: string | null
          updated_at: string | null
        }
        Insert: {
          actual_qty?: number | null
          blender_ref?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number | null
          scrap_qty?: number | null
          session_id?: string | null
          sku_id?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_qty?: number | null
          blender_ref?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number | null
          scrap_qty?: number | null
          session_id?: string | null
          sku_id?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_production_targets_20260722: {
        Row: {
          created_at: string | null
          id: string | null
          line: string | null
          shift: string | null
          sku_id: string | null
          target_qty: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          line?: string | null
          shift?: string | null
          sku_id?: string | null
          target_qty?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          line?: string | null
          shift?: string | null
          sku_id?: string | null
          target_qty?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_sku_production_history_20260722: {
        Row: {
          created_at: string | null
          id: string | null
          line_id: string | null
          quantity: number | null
          run_minutes: number | null
          session_date: string | null
          shift: string | null
          sku_id: string | null
          units_per_hour: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          line_id?: string | null
          quantity?: number | null
          run_minutes?: number | null
          session_date?: string | null
          shift?: string | null
          sku_id?: string | null
          units_per_hour?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          line_id?: string | null
          quantity?: number | null
          run_minutes?: number | null
          session_date?: string | null
          shift?: string | null
          sku_id?: string | null
          units_per_hour?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_sku_products_20260722: {
        Row: {
          active: boolean | null
          category: string | null
          code: string | null
          created_at: string | null
          id: string | null
          name: string | null
          notes: string | null
          target_per_hour: number | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          target_per_hour?: number | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          target_per_hour?: number | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: []
      }
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
      audits: {
        Row: {
          area: string | null
          attachments: string[]
          audit_no: string | null
          audit_type: string
          auditee_name: string | null
          auditee_signature: string | null
          auditee_signed_at: string | null
          auditor_name: string | null
          auditor_signature: string | null
          auditor_signed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          items: Json
          performed_date: string | null
          planned_date: string | null
          result: string | null
          score: number | null
          status: string
          summary: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          attachments?: string[]
          audit_no?: string | null
          audit_type?: string
          auditee_name?: string | null
          auditee_signature?: string | null
          auditee_signed_at?: string | null
          auditor_name?: string | null
          auditor_signature?: string | null
          auditor_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          performed_date?: string | null
          planned_date?: string | null
          result?: string | null
          score?: number | null
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          attachments?: string[]
          audit_no?: string | null
          audit_type?: string
          auditee_name?: string | null
          auditee_signature?: string | null
          auditee_signed_at?: string | null
          auditor_name?: string | null
          auditor_signature?: string | null
          auditor_signed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          performed_date?: string | null
          planned_date?: string | null
          result?: string | null
          score?: number | null
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      batch_dispatch: {
        Row: {
          batch_code: string
          created_at: string
          created_by: string | null
          customer_name: string
          dispatch_date: string | null
          id: string
          notes: string | null
          quantity: number | null
          reference: string | null
          unit: string | null
        }
        Insert: {
          batch_code: string
          created_at?: string
          created_by?: string | null
          customer_name: string
          dispatch_date?: string | null
          id?: string
          notes?: string | null
          quantity?: number | null
          reference?: string | null
          unit?: string | null
        }
        Update: {
          batch_code?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string
          dispatch_date?: string | null
          id?: string
          notes?: string | null
          quantity?: number | null
          reference?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      batch_material_usage: {
        Row: {
          batch_code: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          quantity_used: number | null
          raw_material_lot_id: string
          unit: string | null
        }
        Insert: {
          batch_code: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quantity_used?: number | null
          raw_material_lot_id: string
          unit?: string | null
        }
        Update: {
          batch_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quantity_used?: number | null
          raw_material_lot_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_material_usage_raw_material_lot_id_fkey"
            columns: ["raw_material_lot_id"]
            isOneToOne: false
            referencedRelation: "raw_material_lots"
            referencedColumns: ["id"]
          },
        ]
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
      direct_messages: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          message: string
          read_at: string | null
          recipient_id: string
          sender_id: string
          sender_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
          sender_name: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          message?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
          sender_name?: string
        }
        Relationships: []
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
          labor_rate: number
          name: string
          pin_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          labor_rate?: number
          name: string
          pin_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          labor_rate?: number
          name?: string
          pin_hash?: string
        }
        Relationships: []
      }
      intouch_machine_map: {
        Row: {
          active: boolean
          created_at: string
          id: string | null
          intouch_machine_id: string
          intouch_machine_name: string | null
          last_downtime_code: string | null
          last_seen_at: string | null
          last_status: number | null
          line_id: string | null
          machine_name: string | null
          prod_dt_code: string | null
          prod_dt_started_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string | null
          intouch_machine_id: string
          intouch_machine_name?: string | null
          last_downtime_code?: string | null
          last_seen_at?: string | null
          last_status?: number | null
          line_id?: string | null
          machine_name?: string | null
          prod_dt_code?: string | null
          prod_dt_started_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string | null
          intouch_machine_id?: string
          intouch_machine_name?: string | null
          last_downtime_code?: string | null
          last_seen_at?: string | null
          last_status?: number | null
          line_id?: string | null
          machine_name?: string | null
          prod_dt_code?: string | null
          prod_dt_started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intouch_machine_map_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      intouch_quota_status: {
        Row: {
          blocked_until: string | null
          id: string
          updated_at: string
        }
        Insert: {
          blocked_until?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          blocked_until?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      intouch_stop_code_map: {
        Row: {
          active: boolean
          category: string | null
          code: string | null
          created_at: string
          default_priority: string
          description: string | null
          id: string
          label: string
          line_hint: string | null
          priority: string | null
          requires_wo: boolean
          stop_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          default_priority?: string
          description?: string | null
          id?: string
          label: string
          line_hint?: string | null
          priority?: string | null
          requires_wo?: boolean
          stop_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string | null
          created_at?: string
          default_priority?: string
          description?: string | null
          id?: string
          label?: string
          line_hint?: string | null
          priority?: string | null
          requires_wo?: boolean
          stop_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      intouch_sync_runs: {
        Row: {
          created_at: string
          details: Json
          error_message: string | null
          finished_at: string | null
          function_name: string
          id: string
          started_at: string
          status: string
          trigger_source: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          error_message?: string | null
          finished_at?: string | null
          function_name: string
          id?: string
          started_at?: string
          status: string
          trigger_source?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          error_message?: string | null
          finished_at?: string | null
          function_name?: string
          id?: string
          started_at?: string
          status?: string
          trigger_source?: string | null
        }
        Relationships: []
      }
      intouch_webhook_logs: {
        Row: {
          created_at: string
          created_wo_id: string | null
          error_message: string | null
          headers: Json | null
          id: string
          parsed_ok: boolean
          payload: Json | null
          received_at: string
          source_ip: string | null
        }
        Insert: {
          created_at?: string
          created_wo_id?: string | null
          error_message?: string | null
          headers?: Json | null
          id?: string
          parsed_ok?: boolean
          payload?: Json | null
          received_at?: string
          source_ip?: string | null
        }
        Update: {
          created_at?: string
          created_wo_id?: string | null
          error_message?: string | null
          headers?: Json | null
          id?: string
          parsed_ok?: boolean
          payload?: Json | null
          received_at?: string
          source_ip?: string | null
        }
        Relationships: []
      }
      leader_pins: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          line: string | null
          lines: string[]
          name: string
          pin_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          line?: string | null
          lines?: string[]
          name: string
          pin_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          line?: string | null
          lines?: string[]
          name?: string
          pin_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_chat_messages: {
        Row: {
          created_at: string
          id: string
          line_id: string
          message: string
          user_id: string
          user_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_id: string
          message: string
          user_id: string
          user_name: string
        }
        Update: {
          created_at?: string
          id?: string
          line_id?: string
          message?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_chat_messages_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      line_leaders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          line: string | null
          name: string
          shift: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          line?: string | null
          name: string
          shift: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          line?: string | null
          name?: string
          shift?: string
          updated_at?: string
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
      line_production_baselines: {
        Row: {
          active_days: number
          created_at: string
          daily_avg_units: number
          daily_max_units: number
          daily_p75_units: number
          daily_p90_units: number
          data_period: string | null
          id: string
          line_name: string
          updated_at: string
        }
        Insert: {
          active_days: number
          created_at?: string
          daily_avg_units: number
          daily_max_units: number
          daily_p75_units: number
          daily_p90_units: number
          data_period?: string | null
          id?: string
          line_name: string
          updated_at?: string
        }
        Update: {
          active_days?: number
          created_at?: string
          daily_avg_units?: number
          daily_max_units?: number
          daily_p75_units?: number
          daily_p90_units?: number
          data_period?: string | null
          id?: string
          line_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lines: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          has_sides: boolean
          id: string
          is_warehouse: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          has_sides?: boolean
          id?: string
          is_warehouse?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          has_sides?: boolean
          id?: string
          is_warehouse?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      login_branding: {
        Row: {
          mode: string
          updated_at: string
          updated_by: string | null
          url: string
        }
        Insert: {
          mode: string
          updated_at?: string
          updated_by?: string | null
          url: string
        }
        Update: {
          mode?: string
          updated_at?: string
          updated_by?: string | null
          url?: string
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
          updated_at: string | null
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
          updated_at?: string | null
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
          updated_at?: string | null
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
      materials: {
        Row: {
          active: boolean
          ap_code: string | null
          barcode: string | null
          country: string | null
          created_at: string
          created_by: string | null
          description: string | null
          flavour: string | null
          id: string
          material_type: string
          pack_type: string | null
          size: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          ap_code?: string | null
          barcode?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flavour?: string | null
          id?: string
          material_type?: string
          pack_type?: string | null
          size?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          ap_code?: string | null
          barcode?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flavour?: string | null
          id?: string
          material_type?: string
          pack_type?: string | null
          size?: string | null
          updated_at?: string
        }
        Relationships: []
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
          active: boolean | null
          created_at: string
          created_by: string | null
          email: string
          favicon_url: string | null
          id: string
          label: string
          line_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          created_by?: string | null
          email: string
          favicon_url?: string | null
          id?: string
          label: string
          line_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          created_by?: string | null
          email?: string
          favicon_url?: string | null
          id?: string
          label?: string
          line_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      packaging_bom: {
        Row: {
          component: string
          created_at: string
          created_by: string | null
          id: string
          material_id: string | null
          packaging_type: string
          required_qty: number
          sequence: number | null
          sku: string
          updated_at: string
        }
        Insert: {
          component: string
          created_at?: string
          created_by?: string | null
          id?: string
          material_id?: string | null
          packaging_type: string
          required_qty?: number
          sequence?: number | null
          sku: string
          updated_at?: string
        }
        Update: {
          component?: string
          created_at?: string
          created_by?: string | null
          id?: string
          material_id?: string | null
          packaging_type?: string
          required_qty?: number
          sequence?: number | null
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_bom_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
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
      pin_attempts: {
        Row: {
          created_at: string
          failures: number
          id: string
          last_attempt: string
          locked_until: string | null
          lockout_step: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failures?: number
          id?: string
          last_attempt?: string
          locked_until?: string | null
          lockout_step?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failures?: number
          id?: string
          last_attempt?: string
          locked_until?: string | null
          lockout_step?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pm_executions: {
        Row: {
          checklist_state: Json
          created_at: string
          done_at: string
          done_by: string | null
          done_by_name: string | null
          id: string
          notes: string | null
          schedule_id: string
        }
        Insert: {
          checklist_state?: Json
          created_at?: string
          done_at?: string
          done_by?: string | null
          done_by_name?: string | null
          id?: string
          notes?: string | null
          schedule_id: string
        }
        Update: {
          checklist_state?: Json
          created_at?: string
          done_at?: string
          done_by?: string | null
          done_by_name?: string | null
          id?: string
          notes?: string | null
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_executions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "pm_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_schedules: {
        Row: {
          active: boolean
          assigned_engineer_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          interval_days: number
          last_done_at: string | null
          machine: string
          machine_id: string | null
          machine_name: string | null
          next_due_at: string | null
          priority: string
          tasks: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_engineer_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          interval_days: number
          last_done_at?: string | null
          machine: string
          machine_id?: string | null
          machine_name?: string | null
          next_due_at?: string | null
          priority?: string
          tasks?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_engineer_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          interval_days?: number
          last_done_at?: string | null
          machine?: string
          machine_id?: string | null
          machine_name?: string | null
          next_due_at?: string | null
          priority?: string
          tasks?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      pm_tasks: {
        Row: {
          created_at: string
          id: string
          required: boolean
          schedule_id: string
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          required?: boolean
          schedule_id: string
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          required?: boolean
          schedule_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_tasks_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "pm_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_log: {
        Row: {
          actual_qty: number | null
          applied_target: number | null
          base_target: number
          carryover_adj: number
          created_at: string
          created_by: string | null
          entry_date: string
          error_pct: number | null
          id: string
          line: string
          mtbf_adj: number
          notes: Json
          predicted_target: number
          resolved: boolean
          resolved_at: string | null
          shift: string
          updated_at: string
        }
        Insert: {
          actual_qty?: number | null
          applied_target?: number | null
          base_target?: number
          carryover_adj?: number
          created_at?: string
          created_by?: string | null
          entry_date: string
          error_pct?: number | null
          id?: string
          line: string
          mtbf_adj?: number
          notes?: Json
          predicted_target?: number
          resolved?: boolean
          resolved_at?: string | null
          shift: string
          updated_at?: string
        }
        Update: {
          actual_qty?: number | null
          applied_target?: number | null
          base_target?: number
          carryover_adj?: number
          created_at?: string
          created_by?: string | null
          entry_date?: string
          error_pct?: number | null
          id?: string
          line?: string
          mtbf_adj?: number
          notes?: Json
          predicted_target?: number
          resolved?: boolean
          resolved_at?: string | null
          shift?: string
          updated_at?: string
        }
        Relationships: []
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
      production_blender_entries: {
        Row: {
          blender_number: number
          created_at: string
          entered_by: string | null
          id: string
          production_item_id: string
          quantity: number
          session_id: string
          updated_at: string
        }
        Insert: {
          blender_number: number
          created_at?: string
          entered_by?: string | null
          id?: string
          production_item_id: string
          quantity?: number
          session_id: string
          updated_at?: string
        }
        Update: {
          blender_number?: number
          created_at?: string
          entered_by?: string | null
          id?: string
          production_item_id?: string
          quantity?: number
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_blender_entries_production_item_id_fkey"
            columns: ["production_item_id"]
            isOneToOne: false
            referencedRelation: "production_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_blender_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "production_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      production_downtimes: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          downtime_date: string | null
          duration_minutes: number
          ended_at: string | null
          id: string
          leader_name: string | null
          line: string
          machine: string | null
          notes: string | null
          occurred_date: string
          reason: string | null
          shift: string
          source: string | null
          started_at: string | null
          updated_at: string
          work_order_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          downtime_date?: string | null
          duration_minutes: number
          ended_at?: string | null
          id?: string
          leader_name?: string | null
          line: string
          machine?: string | null
          notes?: string | null
          occurred_date?: string
          reason?: string | null
          shift: string
          source?: string | null
          started_at?: string | null
          updated_at?: string
          work_order_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          downtime_date?: string | null
          duration_minutes?: number
          ended_at?: string | null
          id?: string
          leader_name?: string | null
          line?: string
          machine?: string | null
          notes?: string | null
          occurred_date?: string
          reason?: string | null
          shift?: string
          source?: string | null
          started_at?: string | null
          updated_at?: string
          work_order_id?: string | null
        }
        Relationships: []
      }
      production_items: {
        Row: {
          actual_qty: number
          blender_ref: string | null
          created_at: string
          display_order: number
          finished_at: string | null
          id: string
          intouch_qty: number | null
          notes: string | null
          planned_qty: number
          scrap_qty: number
          session_id: string
          sku_code_text: string | null
          sku_id: string | null
          started_at: string | null
          target_manual_at: string | null
          target_manual_by: string | null
          target_qty: number | null
          tickets_unit: string | null
          updated_at: string
        }
        Insert: {
          actual_qty?: number
          blender_ref?: string | null
          created_at?: string
          display_order?: number
          finished_at?: string | null
          id?: string
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number
          scrap_qty?: number
          session_id: string
          sku_code_text?: string | null
          sku_id?: string | null
          started_at?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string
        }
        Update: {
          actual_qty?: number
          blender_ref?: string | null
          created_at?: string
          display_order?: number
          finished_at?: string | null
          id?: string
          intouch_qty?: number | null
          notes?: string | null
          planned_qty?: number
          scrap_qty?: number
          session_id?: string
          sku_code_text?: string | null
          sku_id?: string | null
          started_at?: string | null
          target_manual_at?: string | null
          target_manual_by?: string | null
          target_qty?: number | null
          tickets_unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "production_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_items_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          country: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          line: string | null
          packaging_type: string | null
          pallet_qr: string | null
          planned_date: string | null
          po_number: string
          qty: number | null
          sku: string | null
          status: string
          trello_ref: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          line?: string | null
          packaging_type?: string | null
          pallet_qr?: string | null
          planned_date?: string | null
          po_number: string
          qty?: number | null
          sku?: string | null
          status?: string
          trello_ref?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          line?: string | null
          packaging_type?: string | null
          pallet_qr?: string | null
          planned_date?: string | null
          po_number?: string
          qty?: number | null
          sku?: string | null
          status?: string
          trello_ref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      production_sessions: {
        Row: {
          created_at: string
          down_time_min: number | null
          finished_at: string | null
          id: string
          intouch_good_total: number | null
          leader_id: string | null
          leader_name: string | null
          line: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          metrics_synced_at: string | null
          notes: string | null
          oee_pct: number | null
          run_time_min: number | null
          session_date: string
          shift: string
          staff_actual: number | null
          staff_planned: number | null
          started_at: string
          started_by: string | null
          tickets: number | null
          tickets_unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          down_time_min?: number | null
          finished_at?: string | null
          id?: string
          intouch_good_total?: number | null
          leader_id?: string | null
          leader_name?: string | null
          line: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          metrics_synced_at?: string | null
          notes?: string | null
          oee_pct?: number | null
          run_time_min?: number | null
          session_date: string
          shift: string
          staff_actual?: number | null
          staff_planned?: number | null
          started_at?: string
          started_by?: string | null
          tickets?: number | null
          tickets_unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          down_time_min?: number | null
          finished_at?: string | null
          id?: string
          intouch_good_total?: number | null
          leader_id?: string | null
          leader_name?: string | null
          line?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          metrics_synced_at?: string | null
          notes?: string | null
          oee_pct?: number | null
          run_time_min?: number | null
          session_date?: string
          shift?: string
          staff_actual?: number | null
          staff_planned?: number | null
          started_at?: string
          started_by?: string | null
          tickets?: number | null
          tickets_unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_sessions_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "line_leaders"
            referencedColumns: ["id"]
          },
        ]
      }
      production_targets: {
        Row: {
          created_at: string
          id: string
          line: string
          shift: string
          sku_id: string
          target_qty: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          line: string
          shift: string
          sku_id: string
          target_qty?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          line?: string
          shift?: string
          sku_id?: string
          target_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_targets_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_products"
            referencedColumns: ["id"]
          },
        ]
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
          production_line: string | null
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
          production_line?: string | null
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
          production_line?: string | null
          shift?: string | null
          ui_preferences?: Json
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          purchase_order_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          purchase_order_id: string
          quantity: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          purchase_order_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          received_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
      pvs_sessions: {
        Row: {
          completed_at: string | null
          id: string
          line: string | null
          operator: string | null
          order_id: string | null
          po_number: string | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          line?: string | null
          operator?: string | null
          order_id?: string | null
          po_number?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          line?: string | null
          operator?: string | null
          order_id?: string | null
          po_number?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pvs_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_inspections: {
        Row: {
          batch_code: string | null
          checks: Json
          created_at: string
          created_by: string | null
          id: string
          inspected_on: string
          inspector_name: string | null
          line: string | null
          notes: string | null
          release: string
          shift: string | null
          status: string
          updated_at: string
        }
        Insert: {
          batch_code?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          inspected_on?: string
          inspector_name?: string | null
          line?: string | null
          notes?: string | null
          release?: string
          shift?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          batch_code?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          inspected_on?: string
          inspector_name?: string | null
          line?: string | null
          notes?: string | null
          release?: string
          shift?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      quality_action_history: {
        Row: {
          action_id: string
          changed_at: string
          changed_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          action_id: string
          changed_at?: string
          changed_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          action_id?: string
          changed_at?: string
          changed_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_action_history_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "quality_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_action_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          label: string
          points: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          label: string
          points?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          label?: string
          points?: number
          updated_at?: string
        }
        Relationships: []
      }
      quality_actions: {
        Row: {
          action_no: string | null
          action_type_id: string | null
          attachments: string[]
          batch: string | null
          created_at: string
          department: string | null
          description: string | null
          id: string
          labels: string[]
          leader_id: string | null
          leader_name: string | null
          line: string | null
          points: number | null
          recorded_at: string
          recorded_by: string | null
          session_id: string | null
          severity: string | null
          shift: string | null
          sku: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_no?: string | null
          action_type_id?: string | null
          attachments?: string[]
          batch?: string | null
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          labels?: string[]
          leader_id?: string | null
          leader_name?: string | null
          line?: string | null
          points?: number | null
          recorded_at?: string
          recorded_by?: string | null
          session_id?: string | null
          severity?: string | null
          shift?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_no?: string | null
          action_type_id?: string | null
          attachments?: string[]
          batch?: string | null
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          labels?: string[]
          leader_id?: string | null
          leader_name?: string | null
          line?: string | null
          points?: number | null
          recorded_at?: string
          recorded_by?: string | null
          session_id?: string | null
          severity?: string | null
          shift?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_actions_action_type_id_fkey"
            columns: ["action_type_id"]
            isOneToOne: false
            referencedRelation: "quality_action_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "production_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_capa: {
        Row: {
          action_id: string
          action_plan: string | null
          capa_no: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          effectiveness: string | null
          effectiveness_ok: boolean | null
          five_whys: Json
          id: string
          ishikawa: Json
          problem: string | null
          responsible: string | null
          root_cause: string | null
          status: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          action_id: string
          action_plan?: string | null
          capa_no?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          effectiveness?: string | null
          effectiveness_ok?: boolean | null
          five_whys?: Json
          id?: string
          ishikawa?: Json
          problem?: string | null
          responsible?: string | null
          root_cause?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          action_id?: string
          action_plan?: string | null
          capa_no?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          effectiveness?: string | null
          effectiveness_ok?: boolean | null
          five_whys?: Json
          id?: string
          ishikawa?: Json
          problem?: string | null
          responsible?: string | null
          root_cause?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_capa_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: true
            referencedRelation: "quality_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_daily_stats: {
        Row: {
          batches: number
          ccp_checks: number
          created_by: string | null
          id: string
          line: string
          notes: string | null
          qas_checks: number
          stat_date: string
          toolbox_checks: number
          updated_at: string
        }
        Insert: {
          batches?: number
          ccp_checks?: number
          created_by?: string | null
          id?: string
          line: string
          notes?: string | null
          qas_checks?: number
          stat_date: string
          toolbox_checks?: number
          updated_at?: string
        }
        Update: {
          batches?: number
          ccp_checks?: number
          created_by?: string | null
          id?: string
          line?: string
          notes?: string | null
          qas_checks?: number
          stat_date?: string
          toolbox_checks?: number
          updated_at?: string
        }
        Relationships: []
      }
      quality_options: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          sort: number
          value: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind: string
          sort?: number
          value: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          sort?: number
          value?: string
        }
        Relationships: []
      }
      quality_weekly_stats: {
        Row: {
          batches: number
          ccp_checks: number
          created_by: string | null
          id: string
          line: string
          notes: string | null
          qas_checks: number
          toolbox_checks: number
          updated_at: string
          week_start: string
        }
        Insert: {
          batches?: number
          ccp_checks?: number
          created_by?: string | null
          id?: string
          line: string
          notes?: string | null
          qas_checks?: number
          toolbox_checks?: number
          updated_at?: string
          week_start: string
        }
        Update: {
          batches?: number
          ccp_checks?: number
          created_by?: string | null
          id?: string
          line?: string
          notes?: string | null
          qas_checks?: number
          toolbox_checks?: number
          updated_at?: string
          week_start?: string
        }
        Relationships: []
      }
      rag_week_exclusions: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          line: string
          shift: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date: string
          id?: string
          line: string
          shift: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          line?: string
          shift?: string
        }
        Relationships: []
      }
      rag_weekly_comments: {
        Row: {
          comment: string
          created_at: string
          entry_date: string
          id: string
          line: string
          updated_at: string
          updated_by: string | null
          week_start: string
        }
        Insert: {
          comment?: string
          created_at?: string
          entry_date: string
          id?: string
          line: string
          updated_at?: string
          updated_by?: string | null
          week_start: string
        }
        Update: {
          comment?: string
          created_at?: string
          entry_date?: string
          id?: string
          line?: string
          updated_at?: string
          updated_by?: string | null
          week_start?: string
        }
        Relationships: []
      }
      rag_weekly_entries: {
        Row: {
          actual_qty: number
          actual_updated_by: string | null
          created_at: string
          created_by: string | null
          downtime_min: number
          entry_date: string
          id: string
          line: string
          notes: string | null
          plan_qty: number
          shift: string
          updated_at: string
          upm_actual: number
          upm_target: number
        }
        Insert: {
          actual_qty?: number
          actual_updated_by?: string | null
          created_at?: string
          created_by?: string | null
          downtime_min?: number
          entry_date: string
          id?: string
          line: string
          notes?: string | null
          plan_qty?: number
          shift: string
          updated_at?: string
          upm_actual?: number
          upm_target?: number
        }
        Update: {
          actual_qty?: number
          actual_updated_by?: string | null
          created_at?: string
          created_by?: string | null
          downtime_min?: number
          entry_date?: string
          id?: string
          line?: string
          notes?: string | null
          plan_qty?: number
          shift?: string
          updated_at?: string
          upm_actual?: number
          upm_target?: number
        }
        Relationships: []
      }
      raw_material_lots: {
        Row: {
          coa_ref: string | null
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          material_name: string
          notes: string | null
          quantity: number | null
          received_on: string | null
          supplier_lot: string | null
          supplier_name: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          coa_ref?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          material_name: string
          notes?: string | null
          quantity?: number | null
          received_on?: string | null
          supplier_lot?: string | null
          supplier_name?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          coa_ref?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          material_name?: string
          notes?: string | null
          quantity?: number | null
          received_on?: string | null
          supplier_lot?: string | null
          supplier_name?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      role_mobile_hidden: {
        Row: {
          action: string
          created_at: string
          role: string
        }
        Insert: {
          action: string
          created_at?: string
          role: string
        }
        Update: {
          action?: string
          created_at?: string
          role?: string
        }
        Relationships: []
      }
      role_permission_overrides: {
        Row: {
          action: string
          allowed: boolean
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action: string
          allowed: boolean
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action?: string
          allowed?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      scan_events: {
        Row: {
          component: string | null
          expected_material_id: string | null
          id: string
          operator: string | null
          order_id: string | null
          result: string
          scanned_at: string
          scanned_barcode: string | null
          scanned_material_id: string | null
          session_id: string | null
        }
        Insert: {
          component?: string | null
          expected_material_id?: string | null
          id?: string
          operator?: string | null
          order_id?: string | null
          result: string
          scanned_at?: string
          scanned_barcode?: string | null
          scanned_material_id?: string | null
          session_id?: string | null
        }
        Update: {
          component?: string | null
          expected_material_id?: string | null
          id?: string
          operator?: string | null
          order_id?: string | null
          result?: string
          scanned_at?: string
          scanned_barcode?: string | null
          scanned_material_id?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pvs_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_report_settings: {
        Row: {
          day_enabled: boolean
          extra_recipients: string[]
          id: string
          include_admins_managers: boolean
          last_sent_day_at: string | null
          last_sent_night_at: string | null
          night_enabled: boolean
          updated_at: string
        }
        Insert: {
          day_enabled?: boolean
          extra_recipients?: string[]
          id?: string
          include_admins_managers?: boolean
          last_sent_day_at?: string | null
          last_sent_night_at?: string | null
          night_enabled?: boolean
          updated_at?: string
        }
        Update: {
          day_enabled?: boolean
          extra_recipients?: string[]
          id?: string
          include_admins_managers?: boolean
          last_sent_day_at?: string | null
          last_sent_night_at?: string | null
          night_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      signup_config: {
        Row: {
          enabled: boolean
          id: boolean
          invite_code: string | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          invite_code?: string | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: boolean
          invite_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sku_line_speeds: {
        Row: {
          avg_units_per_hour: number
          created_at: string | null
          data_source: string | null
          id: string
          line_name: string
          max_units_per_hour: number | null
          min_units_per_hour: number | null
          shift: string
          sku_code: string
          sku_name: string | null
          total_qty_produced: number | null
          total_sessions: number | null
          updated_at: string | null
        }
        Insert: {
          avg_units_per_hour: number
          created_at?: string | null
          data_source?: string | null
          id?: string
          line_name: string
          max_units_per_hour?: number | null
          min_units_per_hour?: number | null
          shift?: string
          sku_code: string
          sku_name?: string | null
          total_qty_produced?: number | null
          total_sessions?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_units_per_hour?: number
          created_at?: string | null
          data_source?: string | null
          id?: string
          line_name?: string
          max_units_per_hour?: number | null
          min_units_per_hour?: number | null
          shift?: string
          sku_code?: string
          sku_name?: string | null
          total_qty_produced?: number | null
          total_sessions?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sku_production_history: {
        Row: {
          created_at: string
          id: string
          line_id: string
          quantity: number
          run_minutes: number
          session_date: string
          shift: string
          sku_id: string
          units_per_hour: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_id: string
          quantity?: number
          run_minutes?: number
          session_date: string
          shift: string
          sku_id: string
          units_per_hour?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          line_id?: string
          quantity?: number
          run_minutes?: number
          session_date?: string
          shift?: string
          sku_id?: string
          units_per_hour?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_production_history_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sku_production_history_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_products"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_products: {
        Row: {
          active: boolean
          category: string | null
          code: string
          created_at: string
          id: string
          name: string
          notes: string | null
          target_per_hour: number
          updated_at: string
          weight: number | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          target_per_hour?: number
          updated_at?: string
          weight?: number | null
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          target_per_hour?: number
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          active: boolean
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          admin_pin: string
          created_at: string
          id: string
          intouch_auto_wo_enabled: boolean
          intouch_sync_enabled: boolean
          updated_at: string
        }
        Insert: {
          admin_pin?: string
          created_at?: string
          id?: string
          intouch_auto_wo_enabled?: boolean
          intouch_sync_enabled?: boolean
          updated_at?: string
        }
        Update: {
          admin_pin?: string
          created_at?: string
          id?: string
          intouch_auto_wo_enabled?: boolean
          intouch_sync_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      teams_webhook_logs: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          event: string
          id: string
          response_body: string | null
          status_code: number | null
          success: boolean
          title: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          event: string
          id?: string
          response_body?: string | null
          status_code?: number | null
          success: boolean
          title?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          event?: string
          id?: string
          response_body?: string | null
          status_code?: number | null
          success?: boolean
          title?: string | null
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
          engineer_notified_at: string | null
          finished_at: string | null
          id: string
          intouch_downtime_code: string | null
          intouch_machine_id: string | null
          intouch_machine_name: string | null
          intouch_stop_code: string | null
          intouch_stop_reason: string | null
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
          operator_id: string | null
          operator_signature_name: string | null
          pause_reason: string
          paused_at: string | null
          physical_line_id: string | null
          priority: string
          received_at: string | null
          recurrence_of_wo_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reopen_count: number
          requester_name: string
          signed_by_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes: number
          updated_at: string | null
          warehouse_location: string | null
          wo_number: number
          wo_type: string
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
          engineer_notified_at?: string | null
          finished_at?: string | null
          id?: string
          intouch_downtime_code?: string | null
          intouch_machine_id?: string | null
          intouch_machine_name?: string | null
          intouch_stop_code?: string | null
          intouch_stop_reason?: string | null
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
          operator_id?: string | null
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          physical_line_id?: string | null
          priority?: string
          received_at?: string | null
          recurrence_of_wo_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopen_count?: number
          requester_name: string
          signed_by_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes?: number
          updated_at?: string | null
          warehouse_location?: string | null
          wo_number?: number
          wo_type?: string
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
          engineer_notified_at?: string | null
          finished_at?: string | null
          id?: string
          intouch_downtime_code?: string | null
          intouch_machine_id?: string | null
          intouch_machine_name?: string | null
          intouch_stop_code?: string | null
          intouch_stop_reason?: string | null
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
          operator_id?: string | null
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          physical_line_id?: string | null
          priority?: string
          received_at?: string | null
          recurrence_of_wo_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopen_count?: number
          requester_name?: string
          signed_by_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["wo_status"]
          total_paused_minutes?: number
          updated_at?: string | null
          warehouse_location?: string | null
          wo_number?: number
          wo_type?: string
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
      admin_update_auth_email: {
        Args: { _new_email: string; _user_id: string }
        Returns: undefined
      }
      check_invite_code: { Args: { code: string }; Returns: boolean }
      cleanup_batch_skus: {
        Args: never
        Returns: {
          deleted: number
          repointed: number
        }[]
      }
      clear_all_production: {
        Args: never
        Returns: {
          blenders_deleted: number
          items_deleted: number
        }[]
      }
      compute_smart_target: {
        Args: { _entry_date: string; _line: string; _shift: string }
        Returns: Json
      }
      create_leader:
        | { Args: { _name: string; _pin: string }; Returns: string }
        | {
            Args: { _lines?: string[]; _name: string; _pin: string }
            Returns: string
          }
      current_device_line: { Args: never; Returns: string }
      current_device_line_ids: { Args: never; Returns: string[] }
      current_device_token: { Args: never; Returns: string }
      current_user_line_id: { Args: never; Returns: string }
      current_user_line_names: { Args: never; Returns: string[] }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      delete_leader: { Args: { _id: string }; Returns: undefined }
      finish_wo_with_pin: {
        Args: { _pin: string; _signed_by_name?: string; _wo_id: string }
        Returns: Json
      }
      get_device_line: { Args: { _token: string }; Returns: string }
      get_login_branding: {
        Args: never
        Returns: {
          mode: string
          updated_at: string
          url: string
        }[]
      }
      get_own_labor_rate: { Args: never; Returns: number }
      get_profile_labor_rate: { Args: { _user_id: string }; Returns: number }
      get_sku_speed_suggestion: {
        Args: { _days?: number; _line_id: string; _sku_id: string }
        Returns: Json
      }
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
      import_sku_products: { Args: { _rows: Json }; Returns: Json }
      is_operator_chat_admin: { Args: { uid: string }; Returns: boolean }
      list_active_profile_names: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      list_dm_admins: {
        Args: never
        Returns: {
          email: string
          line_labels: string
          name: string
          user_id: string
        }[]
      }
      list_dm_operators: {
        Args: never
        Returns: {
          email: string
          line_labels: string
          name: string
          user_id: string
        }[]
      }
      list_dm_partners: {
        Args: never
        Returns: {
          email: string
          line_labels: string
          name: string
          user_id: string
        }[]
      }
      list_engineer_labor_rates: {
        Args: never
        Returns: {
          id: string
          labor_rate: number
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
      list_leaders: {
        Args: never
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          line: string
          lines: string[]
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
          favicon_url: string
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
      reject_wo: { Args: { _reason: string; _wo_id: string }; Returns: Json }
      reopen_wo_as_recurrence: {
        Args: { _reason: string; _wo_id: string }
        Returns: Json
      }
      reopen_wo_recurrence: {
        Args: { _reason: string; _wo_id: string }
        Returns: Json
      }
      restore_item_skus_from_backup: { Args: never; Returns: number }
      restore_remaining_null_skus: { Args: never; Returns: number }
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
      update_leader:
        | {
            Args: {
              _active?: boolean
              _id: string
              _name?: string
              _pin?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _active?: boolean
              _id: string
              _lines?: string[]
              _name?: string
              _pin?: string
            }
            Returns: undefined
          }
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
      verify_pin_with_lockout: { Args: { _pin: string }; Returns: Json }
      wo_total_pause_seconds: { Args: { _wo_id: string }; Returns: number }
    }
    Enums: {
      app_role:
        | "admin"
        | "engineer"
        | "operator"
        | "manager"
        | "viewer"
        | "maintenance_manager"
        | "co_engineer"
        | "supervisor"
        | "planner"
        | "warehouse"
        | "quality_supervisor"
      machine_category: "line_fixed" | "line_mobile" | "support"
      mobile_asset_type: "printer" | "bag_sealer"
      po_status: "draft" | "sent" | "received" | "cancelled"
      wo_status:
        | "open"
        | "in_progress"
        | "completed"
        | "force_closed"
        | "received"
        | "arrived"
        | "finished"
        | "closed"
        | "rejected"
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
      app_role: [
        "admin",
        "engineer",
        "operator",
        "manager",
        "viewer",
        "maintenance_manager",
        "co_engineer",
        "supervisor",
        "planner",
        "warehouse",
        "quality_supervisor",
      ],
      machine_category: ["line_fixed", "line_mobile", "support"],
      mobile_asset_type: ["printer", "bag_sealer"],
      po_status: ["draft", "sent", "received", "cancelled"],
      wo_status: [
        "open",
        "in_progress",
        "completed",
        "force_closed",
        "received",
        "arrived",
        "finished",
        "closed",
        "rejected",
      ],
    },
  },
} as const
