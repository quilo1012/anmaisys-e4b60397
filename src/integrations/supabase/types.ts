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
            foreignKeyName: "downtime_work_order_id_fkey"
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
          code: string | null
          created_at: string
          current_location: string
          health_score: number
          id: string
          last_maintenance_date: string | null
          line: string | null
          machine_type: string
          name: string
          sector: string | null
          status: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          current_location?: string
          health_score?: number
          id?: string
          last_maintenance_date?: string | null
          line?: string | null
          machine_type?: string
          name: string
          sector?: string | null
          status?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          current_location?: string
          health_score?: number
          id?: string
          last_maintenance_date?: string | null
          line?: string | null
          machine_type?: string
          name?: string
          sector?: string | null
          status?: string | null
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
          pin: string | null
          shift: string | null
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
          pin?: string | null
          shift?: string | null
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
          pin?: string | null
          shift?: string | null
          updated_at?: string
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
            foreignKeyName: "work_order_logs_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "engineers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_logs_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "engineers_safe"
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
          completed_at: string | null
          created_at: string
          description: string
          engineer_id: string | null
          engineer_name: string | null
          finished_at: string | null
          id: string
          machine: string
          notes: string | null
          notified_engineers: string[] | null
          operator_id: string
          operator_signature_name: string | null
          pause_reason: string
          paused_at: string | null
          priority: string
          received_at: string | null
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
          completed_at?: string | null
          created_at?: string
          description: string
          engineer_id?: string | null
          engineer_name?: string | null
          finished_at?: string | null
          id?: string
          machine: string
          notes?: string | null
          notified_engineers?: string[] | null
          operator_id: string
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          priority?: string
          received_at?: string | null
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
          completed_at?: string | null
          created_at?: string
          description?: string
          engineer_id?: string | null
          engineer_name?: string | null
          finished_at?: string | null
          id?: string
          machine?: string
          notes?: string | null
          notified_engineers?: string[] | null
          operator_id?: string
          operator_signature_name?: string | null
          pause_reason?: string
          paused_at?: string | null
          priority?: string
          received_at?: string | null
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
            foreignKeyName: "work_orders_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "engineers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "engineers_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
    }
    Functions: {
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
      log_audit_event: {
        Args: {
          _action: string
          _details?: Json
          _entity_id?: string
          _entity_type: string
        }
        Returns: undefined
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
    }
    Enums: {
      app_role: "admin" | "engineer" | "operator" | "manager"
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
      app_role: ["admin", "engineer", "operator", "manager"],
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
