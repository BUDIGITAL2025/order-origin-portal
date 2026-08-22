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
      bundle_components: {
        Row: {
          bundle_product_id: string
          component_product_id: string
          created_at: string
          id: string
          quantity: number
        }
        Insert: {
          bundle_product_id: string
          component_product_id: string
          created_at?: string
          id?: string
          quantity: number
        }
        Update: {
          bundle_product_id?: string
          component_product_id?: string
          created_at?: string
          id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "bundle_components_bundle_product_id_fkey"
            columns: ["bundle_product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "bundle_components_bundle_product_id_fkey"
            columns: ["bundle_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_components_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "bundle_components_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          client_id: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
        }
        Insert: {
          body: string
          client_id: string
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          client_id: string
          created_at: string
          id: string
          lead_time_days: number | null
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          unit_price: number | null
          variant_label: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          middleware_product_id?: string | null
          moq?: number | null
          price_override?: number | null
          product_name: string
          product_type?: Database["public"]["Enums"]["product_type"]
          push_error?: string | null
          push_status?: Database["public"]["Enums"]["push_status"]
          quote_line_id?: string | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          unit_price?: number | null
          variant_label?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          middleware_product_id?: string | null
          moq?: number | null
          price_override?: number | null
          product_name?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          push_error?: string | null
          push_status?: Database["public"]["Enums"]["push_status"]
          quote_line_id?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          unit_price?: number | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: true
            referencedRelation: "quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: true
            referencedRelation: "quote_lines_client"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          auto_topup_amount: number | null
          auto_topup_enabled: boolean
          auto_topup_threshold: number | null
          avg_daily_units_30d: number
          cancel_notice_sent_at: string | null
          company_name: string
          contact_name: string
          country: string
          created_at: string
          default_payment_method_id: string | null
          fee_waived: boolean
          id: string
          integration_mode: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id: string | null
          pending_plan_change:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date: string | null
          phone: string
          platform: Database["public"]["Enums"]["store_platform"]
          pricing_tier: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error: string | null
          provisioning_status: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step: string | null
          quotes_period_start: string
          quotes_used_this_month: number
          status: Database["public"]["Enums"]["profile_status"]
          store_url: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          tier_override: Database["public"]["Enums"]["pricing_tier"] | null
          vat_number: string
        }
        Insert: {
          approved_at?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          avg_daily_units_30d?: number
          cancel_notice_sent_at?: string | null
          company_name: string
          contact_name: string
          country: string
          created_at?: string
          default_payment_method_id?: string | null
          fee_waived?: boolean
          id: string
          integration_mode?: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id?: string | null
          pending_plan_change?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date?: string | null
          phone: string
          platform?: Database["public"]["Enums"]["store_platform"]
          pricing_tier?: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          quotes_period_start?: string
          quotes_used_this_month?: number
          status?: Database["public"]["Enums"]["profile_status"]
          store_url: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          tier_override?: Database["public"]["Enums"]["pricing_tier"] | null
          vat_number: string
        }
        Update: {
          approved_at?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          avg_daily_units_30d?: number
          cancel_notice_sent_at?: string | null
          company_name?: string
          contact_name?: string
          country?: string
          created_at?: string
          default_payment_method_id?: string | null
          fee_waived?: boolean
          id?: string
          integration_mode?: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id?: string | null
          pending_plan_change?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date?: string | null
          phone?: string
          platform?: Database["public"]["Enums"]["store_platform"]
          pricing_tier?: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          quotes_period_start?: string
          quotes_used_this_month?: number
          status?: Database["public"]["Enums"]["profile_status"]
          store_url?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          tier_override?: Database["public"]["Enums"]["pricing_tier"] | null
          vat_number?: string
        }
        Relationships: []
      }
      quote_lines: {
        Row: {
          created_at: string
          id: string
          lead_time_days: number | null
          markup_product: number | null
          markup_shipping: number | null
          moq: number | null
          quote_request_id: string
          responded_at: string | null
          sku: string
          status: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs: number | null
          supplier_shipping: number | null
          supplier_tax: number | null
          unit_price: number | null
          variant_label: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_time_days?: number | null
          markup_product?: number | null
          markup_shipping?: number | null
          moq?: number | null
          quote_request_id: string
          responded_at?: string | null
          sku: string
          status?: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs?: number | null
          supplier_shipping?: number | null
          supplier_tax?: number | null
          unit_price?: number | null
          variant_label: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_time_days?: number | null
          markup_product?: number | null
          markup_shipping?: number | null
          moq?: number | null
          quote_request_id?: string
          responded_at?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs?: number | null
          supplier_shipping?: number | null
          supplier_tax?: number | null
          unit_price?: number | null
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_requests: {
        Row: {
          admin_notes: string | null
          client_id: string
          created_at: string
          id: string
          image_urls: string[] | null
          internal_reference: string | null
          notes: string | null
          product_name: string | null
          product_url: string
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_by: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          supersedes_quote_id: string | null
          target_monthly_volume: number | null
        }
        Insert: {
          admin_notes?: string | null
          client_id: string
          created_at?: string
          id?: string
          image_urls?: string[] | null
          internal_reference?: string | null
          notes?: string | null
          product_name?: string | null
          product_url: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          supersedes_quote_id?: string | null
          target_monthly_volume?: number | null
        }
        Update: {
          admin_notes?: string | null
          client_id?: string
          created_at?: string
          id?: string
          image_urls?: string[] | null
          internal_reference?: string | null
          notes?: string | null
          product_name?: string | null
          product_url?: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          supersedes_quote_id?: string | null
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
          {
            foreignKeyName: "quote_requests_quoted_by_fkey"
            columns: ["quoted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_requests_supersedes_quote_id_fkey"
            columns: ["supersedes_quote_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          created_at: string
          environment: string
          error: string | null
          event_type: string
          id: string
          payload: Json | null
          processed_at: string | null
          stripe_event_id: string
        }
        Insert: {
          created_at?: string
          environment?: string
          error?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          stripe_event_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          stripe_event_id?: string
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
      bundle_prices: {
        Row: {
          bundle_product_id: string | null
          calculated_price: number | null
          component_count: number | null
          effective_price: number | null
          max_lead_time_days: number | null
        }
        Relationships: []
      }
      quote_lines_client: {
        Row: {
          created_at: string | null
          id: string | null
          lead_time_days: number | null
          moq: number | null
          quote_request_id: string | null
          responded_at: string | null
          sku: string | null
          status: Database["public"]["Enums"]["quote_line_status"] | null
          unit_price: number | null
          variant_label: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_save_quote_lines: {
        Args: {
          p_admin_notes?: string
          p_internal_reference?: string
          p_lines: Json
          p_quote_id: string
          p_quote_valid_until?: string
        }
        Returns: {
          created_at: string
          id: string
          lead_time_days: number | null
          markup_product: number | null
          markup_shipping: number | null
          moq: number | null
          quote_request_id: string
          responded_at: string | null
          sku: string
          status: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs: number | null
          supplier_shipping: number | null
          supplier_tax: number | null
          unit_price: number | null
          variant_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "quote_lines"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
      create_bundle: {
        Args: { p_components: Json; p_name: string }
        Returns: {
          client_id: string
          created_at: string
          id: string
          lead_time_days: number | null
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          unit_price: number | null
          variant_label: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      explode_product: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: {
          quantity: number
          sku: string
        }[]
      }
      generate_sku: { Args: { p_prefix: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      release_awaiting_payment_orders: {
        Args: { p_client_id: string }
        Returns: {
          amount: number
          order_id: string
        }[]
      }
      respond_to_quote_lines: {
        Args: { p_decisions: Json; p_product_name: string; p_quote_id: string }
        Returns: number
      }
      submit_quote_request: {
        Args: {
          p_image_urls?: string[]
          p_notes?: string
          p_on_behalf_of?: string
          p_product_name?: string
          p_product_url?: string
          p_supersedes_quote_id?: string
          p_target_monthly_volume?: number
        }
        Returns: {
          admin_notes: string | null
          client_id: string
          created_at: string
          id: string
          image_urls: string[] | null
          internal_reference: string | null
          notes: string | null
          product_name: string | null
          product_url: string
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_by: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          supersedes_quote_id: string | null
          target_monthly_volume: number | null
        }
        SetofOptions: {
          from: "*"
          to: "quote_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_bundle: {
        Args: { p_bundle_id: string; p_components: Json; p_name: string }
        Returns: {
          client_id: string
          created_at: string
          id: string
          lead_time_days: number | null
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          unit_price: number | null
          variant_label: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "client"
      integration_mode: "automatic" | "manual"
      pricing_tier: "starter" | "growth" | "scale"
      product_status: "active" | "discontinued" | "needs_review"
      product_type: "simple" | "bundle"
      profile_status: "pending" | "active" | "suspended"
      provisioning_status: "not_started" | "in_progress" | "complete" | "failed"
      push_status: "pending" | "pushed" | "failed"
      quote_line_status: "pending" | "accepted" | "rejected"
      quote_status: "submitted" | "sourcing" | "quoted" | "closed" | "expired"
      store_platform: "shopify" | "woocommerce" | "other"
      subscription_plan: "basic" | "unlimited"
      subscription_status: "none" | "active" | "past_due" | "canceled"
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
      integration_mode: ["automatic", "manual"],
      pricing_tier: ["starter", "growth", "scale"],
      product_status: ["active", "discontinued", "needs_review"],
      product_type: ["simple", "bundle"],
      profile_status: ["pending", "active", "suspended"],
      provisioning_status: ["not_started", "in_progress", "complete", "failed"],
      push_status: ["pending", "pushed", "failed"],
      quote_line_status: ["pending", "accepted", "rejected"],
      quote_status: ["submitted", "sourcing", "quoted", "closed", "expired"],
      store_platform: ["shopify", "woocommerce", "other"],
      subscription_plan: ["basic", "unlimited"],
      subscription_status: ["none", "active", "past_due", "canceled"],
      wallet_txn_type: ["credit", "debit", "adjustment"],
    },
  },
} as const
