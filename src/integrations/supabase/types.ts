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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          approved_at: string | null
          company_name: string
          contact_name: string
          country: string
          created_at: string
          id: string
          markup_tier: Database["public"]["Enums"]["markup_tier"]
          middleware_tenant_id: string | null
          phone: string
          provisioning_error: string | null
          provisioning_status: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step: string | null
          shopify_domain: string
          status: Database["public"]["Enums"]["profile_status"]
          vat_number: string
        }
        Insert: {
          approved_at?: string | null
          company_name: string
          contact_name: string
          country: string
          created_at?: string
          id: string
          markup_tier?: Database["public"]["Enums"]["markup_tier"]
          middleware_tenant_id?: string | null
          phone: string
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          shopify_domain: string
          status?: Database["public"]["Enums"]["profile_status"]
          vat_number: string
        }
        Update: {
          approved_at?: string | null
          company_name?: string
          contact_name?: string
          country?: string
          created_at?: string
          id?: string
          markup_tier?: Database["public"]["Enums"]["markup_tier"]
          middleware_tenant_id?: string | null
          phone?: string
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          shopify_domain?: string
          status?: Database["public"]["Enums"]["profile_status"]
          vat_number?: string
        }
        Relationships: []
      }
      quote_requests: {
        Row: {
          admin_notes: string | null
          client_id: string
          cost_price: number | null
          created_at: string
          id: string
          image_urls: string[] | null
          lead_time_days: number | null
          markup_percent: number | null
          moq: number | null
          notes: string | null
          product_name: string | null
          product_url: string
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_price: number | null
          responded_at: string | null
          shipping_cost: number | null
          status: Database["public"]["Enums"]["quote_status"]
          target_monthly_volume: number | null
        }
        Insert: {
          admin_notes?: string | null
          client_id: string
          cost_price?: number | null
          created_at?: string
          id?: string
          image_urls?: string[] | null
          lead_time_days?: number | null
          markup_percent?: number | null
          moq?: number | null
          notes?: string | null
          product_name?: string | null
          product_url: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_price?: number | null
          responded_at?: string | null
          shipping_cost?: number | null
          status?: Database["public"]["Enums"]["quote_status"]
          target_monthly_volume?: number | null
        }
        Update: {
          admin_notes?: string | null
          client_id?: string
          cost_price?: number | null
          created_at?: string
          id?: string
          image_urls?: string[] | null
          lead_time_days?: number | null
          markup_percent?: number | null
          moq?: number | null
          notes?: string | null
          product_name?: string | null
          product_url?: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_price?: number | null
          responded_at?: string | null
          shipping_cost?: number | null
          status?: Database["public"]["Enums"]["quote_status"]
          target_monthly_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          client_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          reference: string | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          client_id: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          reference?: string | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          reference?: string | null
          type?: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      quote_requests_client: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string | null
          image_urls: string[] | null
          lead_time_days: number | null
          moq: number | null
          notes: string | null
          product_name: string | null
          product_url: string | null
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_price: number | null
          responded_at: string | null
          status: Database["public"]["Enums"]["quote_status"] | null
          target_monthly_volume: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string | null
          image_urls?: string[] | null
          lead_time_days?: number | null
          moq?: number | null
          notes?: string | null
          product_name?: string | null
          product_url?: string | null
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_price?: number | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"] | null
          target_monthly_volume?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string | null
          image_urls?: string[] | null
          lead_time_days?: number | null
          moq?: number | null
          notes?: string | null
          product_name?: string | null
          product_url?: string | null
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_price?: number | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"] | null
          target_monthly_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_wallet_transaction: {
        Args: {
          p_amount: number
          p_client_id: string
          p_description: string
          p_reference?: string
          p_type: string
        }
        Returns: {
          amount: number
          balance_after: number
          client_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          reference: string | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        SetofOptions: {
          from: "*"
          to: "wallet_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      respond_to_quote: {
        Args: { p_accept: boolean; p_quote_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "client"
      markup_tier: "standard" | "volume" | "partner"
      profile_status: "pending" | "active" | "suspended"
      provisioning_status: "not_started" | "in_progress" | "complete" | "failed"
      quote_status:
        | "submitted"
        | "sourcing"
        | "quoted"
        | "accepted"
        | "rejected"
        | "expired"
      wallet_txn_type: "credit" | "debit" | "adjustment"
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
      app_role: ["admin", "client"],
      markup_tier: ["standard", "volume", "partner"],
      profile_status: ["pending", "active", "suspended"],
      provisioning_status: ["not_started", "in_progress", "complete", "failed"],
      quote_status: [
        "submitted",
        "sourcing",
        "quoted",
        "accepted",
        "rejected",
        "expired",
      ],
      wallet_txn_type: ["credit", "debit", "adjustment"],
    },
  },
} as const
