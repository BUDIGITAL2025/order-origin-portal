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
      cron_runs: {
        Row: {
          created_at: string
          detail: Json | null
          error: string | null
          finished_at: string | null
          id: string
          job: string
          ok: boolean | null
          started_at: string
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job: string
          ok?: boolean | null
          started_at?: string
        }
        Update: {
          created_at?: string
          detail?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          ok?: boolean | null
          started_at?: string
        }
        Relationships: []
      }
      dispute_internal_notes: {
        Row: {
          admin_notes: string | null
          dispute_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          dispute_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          dispute_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispute_internal_notes_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: true
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_internal_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_messages: {
        Row: {
          author_id: string
          author_role: Database["public"]["Enums"]["dispute_author_role"]
          body: string
          created_at: string
          dispute_id: string
          id: string
        }
        Insert: {
          author_id: string
          author_role: Database["public"]["Enums"]["dispute_author_role"]
          body: string
          created_at?: string
          dispute_id: string
          id?: string
        }
        Update: {
          author_id?: string
          author_role?: Database["public"]["Enums"]["dispute_author_role"]
          body?: string
          created_at?: string
          dispute_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_messages_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          credit_amount: number | null
          description: string
          evidence_urls: string[]
          id: string
          opened_by: string
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution: Database["public"]["Enums"]["dispute_resolution"] | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          store_id: string
        }
        Insert: {
          created_at?: string
          credit_amount?: number | null
          description: string
          evidence_urls?: string[]
          id?: string
          opened_by: string
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution?: Database["public"]["Enums"]["dispute_resolution"] | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          store_id: string
        }
        Update: {
          created_at?: string
          credit_amount?: number | null
          description?: string
          evidence_urls?: string[]
          id?: string
          opened_by?: string
          order_id?: string
          reason?: Database["public"]["Enums"]["dispute_reason"]
          resolution?: Database["public"]["Enums"]["dispute_resolution"] | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          amount: number
          created_at: string
          document_number: string
          document_type: Database["public"]["Enums"]["document_type"]
          entity_id: string
          external_invoice_id: string | null
          id: string
          issued_at: string
          order_id: string | null
          payment_reference: string | null
          storage_path: string | null
          store_id: string | null
          wallet_transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          document_number: string
          document_type?: Database["public"]["Enums"]["document_type"]
          entity_id: string
          external_invoice_id?: string | null
          id?: string
          issued_at?: string
          order_id?: string | null
          payment_reference?: string | null
          storage_path?: string | null
          store_id?: string | null
          wallet_transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          document_number?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          entity_id?: string
          external_invoice_id?: string | null
          id?: string
          issued_at?: string
          order_id?: string | null
          payment_reference?: string | null
          storage_path?: string | null
          store_id?: string | null
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          account_id: string
          address: string | null
          auto_topup_amount: number | null
          auto_topup_enabled: boolean
          auto_topup_threshold: number | null
          cancel_notice_sent_at: string | null
          country: string | null
          created_at: string
          default_payment_method_id: string | null
          id: string
          legal_name: string
          max_stores: number
          status: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id: string | null
          vat_number: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          cancel_notice_sent_at?: string | null
          country?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          legal_name: string
          max_stores?: number
          status?: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id?: string | null
          vat_number?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          cancel_notice_sent_at?: string | null
          country?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          legal_name?: string
          max_stores?: number
          status?: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id?: string | null
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          error: string
          id: string
          job: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          error: string
          id?: string
          job: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          error?: string
          id?: string
          job?: string
        }
        Relationships: []
      }
      internal_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          entity_id: string | null
          id: string
          kind: string
          read_at: string | null
          store_id: string | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id?: string | null
          id?: string
          kind: string
          read_at?: string | null
          store_id?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          store_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_batch_payments: {
        Row: {
          amount: number
          created_at: string
          entity_id: string
          id: string
          leftover_credited: number | null
          order_ids: string[]
          settled_at: string | null
          settled_count: number | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          entity_id: string
          id?: string
          leftover_credited?: number | null
          order_ids: string[]
          settled_at?: string | null
          settled_count?: number | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          entity_id?: string
          id?: string
          leftover_credited?: number | null
          order_ids?: string[]
          settled_at?: string | null
          settled_count?: number | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_batch_payments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fulfillment_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          quantity: number
          sku: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          quantity: number
          sku: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          quantity?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_fulfillment_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number | null
          order_id: string
          product_id: string | null
          quantity: number | null
          sku: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id: string
          product_id?: string | null
          quantity?: number | null
          sku?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number | null
          order_id?: string
          product_id?: string | null
          quantity?: number | null
          sku?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          destination_country: string | null
          external_order_id: string | null
          external_order_number: string | null
          id: string
          middleware_order_id: string | null
          needs_review_reason: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          destination_country?: string | null
          external_order_id?: string | null
          external_order_number?: string | null
          id?: string
          middleware_order_id?: string | null
          needs_review_reason?: string | null
          paid_at?: string | null
          payment_method?:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at?: string | null
          reminder_48_sent_at?: string | null
          reminder_72_sent_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount?: number | null
          tracking_carrier?: string | null
          tracking_notified_at?: string | null
          tracking_number?: string | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          destination_country?: string | null
          external_order_id?: string | null
          external_order_number?: string | null
          id?: string
          middleware_order_id?: string | null
          needs_review_reason?: string | null
          paid_at?: string | null
          payment_method?:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at?: string | null
          reminder_48_sent_at?: string | null
          reminder_72_sent_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          total_amount?: number | null
          tracking_carrier?: string | null
          tracking_notified_at?: string | null
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_country_prices: {
        Row: {
          country_code: string
          created_at: string
          id: string
          lead_time_days: number | null
          product_id: string
          unit_price: number
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          product_id: string
          unit_price: number
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          product_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_country_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "product_country_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
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
          store_id: string
          variant_label: string | null
        }
        Insert: {
          created_at?: string
          id?: string
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
          store_id: string
          variant_label?: string | null
        }
        Update: {
          created_at?: string
          id?: string
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
          store_id?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: true
            referencedRelation: "quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cancel_notice_sent_at: string | null
          contact_name: string
          created_at: string
          id: string
          phone: string
          signup_source: Json | null
          status: Database["public"]["Enums"]["profile_status"]
          terms_accepted_at: string | null
          terms_version: string | null
        }
        Insert: {
          cancel_notice_sent_at?: string | null
          contact_name: string
          created_at?: string
          id: string
          phone: string
          signup_source?: Json | null
          status?: Database["public"]["Enums"]["profile_status"]
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Update: {
          cancel_notice_sent_at?: string | null
          contact_name?: string
          created_at?: string
          id?: string
          phone?: string
          signup_source?: Json | null
          status?: Database["public"]["Enums"]["profile_status"]
          terms_accepted_at?: string | null
          terms_version?: string | null
        }
        Relationships: []
      }
      quote_lines: {
        Row: {
          country_code: string
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
          country_code: string
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
          country_code?: string
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
      quote_request_internal: {
        Row: {
          admin_notes: string | null
          internal_reference: string | null
          quote_request_id: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          internal_reference?: string | null
          quote_request_id: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          internal_reference?: string | null
          quote_request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_request_internal_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: true
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_requests: {
        Row: {
          created_at: string
          id: string
          image_urls: string[] | null
          notes: string | null
          preview_id: string | null
          product_name: string | null
          product_url: string
          quote_breach_notified_at: string | null
          quote_due_at: string
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_by: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          store_id: string
          supersedes_quote_id: string | null
          target_countries: string[]
          target_monthly_volume: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_urls?: string[] | null
          notes?: string | null
          preview_id?: string | null
          product_name?: string | null
          product_url: string
          quote_breach_notified_at?: string | null
          quote_due_at?: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          store_id: string
          supersedes_quote_id?: string | null
          target_countries: string[]
          target_monthly_volume?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          image_urls?: string[] | null
          notes?: string | null
          preview_id?: string | null
          product_name?: string | null
          product_url?: string
          quote_breach_notified_at?: string | null
          quote_due_at?: string
          quote_valid_until?: string | null
          quoted_at?: string | null
          quoted_by?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          store_id?: string
          supersedes_quote_id?: string | null
          target_countries?: string[]
          target_monthly_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_requests_preview_id_fkey"
            columns: ["preview_id"]
            isOneToOne: false
            referencedRelation: "url_previews"
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
            foreignKeyName: "quote_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
      spymarket_cache: {
        Row: {
          cache_key: string
          endpoint: string
          fetched_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          endpoint: string
          fetched_at?: string
          payload: Json
        }
        Update: {
          cache_key?: string
          endpoint?: string
          fetched_at?: string
          payload?: Json
        }
        Relationships: []
      }
      spymarket_endpoint_costs: {
        Row: {
          credits_per_row: number
          endpoint: string
          last_observed_at: string | null
          sample_count: number
        }
        Insert: {
          credits_per_row: number
          endpoint: string
          last_observed_at?: string | null
          sample_count?: number
        }
        Update: {
          credits_per_row?: number
          endpoint?: string
          last_observed_at?: string | null
          sample_count?: number
        }
        Relationships: []
      }
      spymarket_interest: {
        Row: {
          account_id: string
          created_at: string
          entity_id: string | null
          id: string
          plan_interest: Database["public"]["Enums"]["spymarket_plan"]
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_id?: string | null
          id?: string
          plan_interest: Database["public"]["Enums"]["spymarket_plan"]
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          plan_interest?: Database["public"]["Enums"]["spymarket_plan"]
        }
        Relationships: [
          {
            foreignKeyName: "spymarket_interest_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spymarket_interest_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      spymarket_subscriptions: {
        Row: {
          account_id: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          environment: string
          id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          plan: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          environment?: string
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      spymarket_usage_log: {
        Row: {
          cache_hit: boolean
          called_by: string | null
          created_at: string
          credits_cost: number
          credits_remaining: number | null
          endpoint: string
          error: string | null
          id: string
          query_summary: Json
          rows_returned: number
        }
        Insert: {
          cache_hit?: boolean
          called_by?: string | null
          created_at?: string
          credits_cost?: number
          credits_remaining?: number | null
          endpoint: string
          error?: string | null
          id?: string
          query_summary?: Json
          rows_returned?: number
        }
        Update: {
          cache_hit?: boolean
          called_by?: string | null
          created_at?: string
          credits_cost?: number
          credits_remaining?: number | null
          endpoint?: string
          error?: string | null
          id?: string
          query_summary?: Json
          rows_returned?: number
        }
        Relationships: [
          {
            foreignKeyName: "spymarket_usage_log_called_by_fkey"
            columns: ["called_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          approved_at: string | null
          avg_daily_units_30d: number
          created_at: string
          entity_id: string
          fee_waived: boolean
          id: string
          integration_mode: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id: string | null
          pending_plan_change:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          pricing_tier: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error: string | null
          provisioning_status: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step: string | null
          quotes_period_start: string
          quotes_used_this_month: number
          status: Database["public"]["Enums"]["profile_status"]
          store_name: string | null
          store_url: string | null
          stripe_subscription_id: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          tier_override: Database["public"]["Enums"]["pricing_tier"] | null
        }
        Insert: {
          approved_at?: string | null
          avg_daily_units_30d?: number
          created_at?: string
          entity_id: string
          fee_waived?: boolean
          id?: string
          integration_mode?: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id?: string | null
          pending_plan_change?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date?: string | null
          platform?: Database["public"]["Enums"]["store_platform"]
          pricing_tier?: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          quotes_period_start?: string
          quotes_used_this_month?: number
          status?: Database["public"]["Enums"]["profile_status"]
          store_name?: string | null
          store_url?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          tier_override?: Database["public"]["Enums"]["pricing_tier"] | null
        }
        Update: {
          approved_at?: string | null
          avg_daily_units_30d?: number
          created_at?: string
          entity_id?: string
          fee_waived?: boolean
          id?: string
          integration_mode?: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id?: string | null
          pending_plan_change?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date?: string | null
          platform?: Database["public"]["Enums"]["store_platform"]
          pricing_tier?: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error?: string | null
          provisioning_status?: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step?: string | null
          quotes_period_start?: string
          quotes_used_this_month?: number
          status?: Database["public"]["Enums"]["profile_status"]
          store_name?: string | null
          store_url?: string | null
          stripe_subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          tier_override?: Database["public"]["Enums"]["pricing_tier"] | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
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
      url_previews: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_urls: string[]
          price_hint: string | null
          requested_by: string | null
          scraped_at: string
          source: Database["public"]["Enums"]["url_preview_source"]
          title: string | null
          url_normalized: string
          variants: string[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          price_hint?: string | null
          requested_by?: string | null
          scraped_at?: string
          source: Database["public"]["Enums"]["url_preview_source"]
          title?: string | null
          url_normalized: string
          variants?: string[]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          price_hint?: string | null
          requested_by?: string | null
          scraped_at?: string
          source?: Database["public"]["Enums"]["url_preview_source"]
          title?: string | null
          url_normalized?: string
          variants?: string[]
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
          created_at: string
          created_by: string | null
          description: string
          entity_id: string
          id: string
          reference: string | null
          seq: number
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          description: string
          entity_id: string
          id?: string
          reference?: string | null
          seq?: never
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          description?: string
          entity_id?: string
          id?: string
          reference?: string | null
          seq?: never
          type?: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
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
          country_code: string | null
          effective_price: number | null
          max_lead_time_days: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_resolve_order_item: {
        Args: { p_item_id: string; p_product_id: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          destination_country: string | null
          external_order_id: string | null
          external_order_number: string | null
          id: string
          middleware_order_id: string | null
          needs_review_reason: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_quote_lines: {
        Args: {
          p_admin_notes?: string
          p_internal_reference?: string
          p_lines: Json
          p_quote_id: string
          p_quote_valid_until?: string
        }
        Returns: {
          country_code: string
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
          p_created_by?: string
          p_description: string
          p_entity_id: string
          p_reference?: string
          p_type: string
        }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          description: string
          entity_id: string
          id: string
          reference: string | null
          seq: number
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        SetofOptions: {
          from: "*"
          to: "wallet_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      connect_draft_store: {
        Args: { p_store_id: string; p_store_name?: string; p_store_url: string }
        Returns: {
          approved_at: string | null
          avg_daily_units_30d: number
          created_at: string
          entity_id: string
          fee_waived: boolean
          id: string
          integration_mode: Database["public"]["Enums"]["integration_mode"]
          middleware_tenant_id: string | null
          pending_plan_change:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          pending_plan_change_date: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          pricing_tier: Database["public"]["Enums"]["pricing_tier"]
          provisioning_error: string | null
          provisioning_status: Database["public"]["Enums"]["provisioning_status"]
          provisioning_step: string | null
          quotes_period_start: string
          quotes_used_this_month: number
          status: Database["public"]["Enums"]["profile_status"]
          store_name: string | null
          store_url: string | null
          stripe_subscription_id: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          tier_override: Database["public"]["Enums"]["pricing_tier"] | null
        }
        SetofOptions: {
          from: "*"
          to: "stores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_bundle: {
        Args: { p_components: Json; p_name: string; p_store_id: string }
        Returns: {
          created_at: string
          id: string
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
          store_id: string
          variant_label: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_order: {
        Args: {
          p_client_reference?: string
          p_customer: Json
          p_lines?: Json
          p_shipping: Json
          p_store_id: string
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          destination_country: string | null
          external_order_id: string | null
          external_order_number: string | null
          id: string
          middleware_order_id: string | null
          needs_review_reason: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_order_internal: {
        Args: {
          p_client_reference: string
          p_customer: Json
          p_lines: Json
          p_shipping: Json
          p_store_id: string
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          destination_country: string | null
          external_order_id: string | null
          external_order_number: string | null
          id: string
          middleware_order_id: string | null
          needs_review_reason: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
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
      generate_document_number: { Args: never; Returns: string }
      generate_sku: { Args: { p_prefix: string }; Returns: string }
      get_client_quote_lines: {
        Args: { p_quote_request_id: string }
        Returns: {
          country_code: string
          created_at: string
          id: string
          lead_time_days: number
          moq: number
          quote_request_id: string
          responded_at: string
          sku: string
          status: Database["public"]["Enums"]["quote_line_status"]
          unit_price: number
          variant_label: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_manual_orders: {
        Args: { p_orders: Json; p_store_id: string }
        Returns: {
          order_id: string
          order_number: string
          status: string
          total: number
        }[]
      }
      ingest_order: {
        Args: {
          p_destination_country: string
          p_external_order_id: string
          p_external_order_number: string
          p_line_items: Json
          p_shipping_address: Json
          p_store_id: string
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          destination_country: string | null
          external_order_id: string | null
          external_order_number: string | null
          id: string
          middleware_order_id: string | null
          needs_review_reason: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["order_payment_method"]
            | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invoke_cron_endpoint: {
        Args: { p_job: string; p_method?: string; p_path: string }
        Returns: undefined
      }
      open_dispute: {
        Args: {
          p_description: string
          p_evidence_urls?: string[]
          p_order_id: string
          p_reason: Database["public"]["Enums"]["dispute_reason"]
        }
        Returns: {
          created_at: string
          credit_amount: number | null
          description: string
          evidence_urls: string[]
          id: string
          opened_by: string
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution: Database["public"]["Enums"]["dispute_resolution"] | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          store_id: string
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_orders_from_wallet: {
        Args: { p_order_ids: string[] }
        Returns: {
          amount: number
          order_id: string
        }[]
      }
      post_dispute_message: {
        Args: { p_body: string; p_dispute_id: string }
        Returns: {
          author_id: string
          author_role: Database["public"]["Enums"]["dispute_author_role"]
          body: string
          created_at: string
          dispute_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "dispute_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_awaiting_payment_orders: {
        Args: { p_entity_id: string }
        Returns: {
          amount: number
          order_id: string
        }[]
      }
      release_order_to_fulfilment: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      resolve_dispute: {
        Args: {
          p_admin_notes?: string
          p_client_message?: string
          p_credit_amount?: number
          p_dispute_id: string
          p_resolution: Database["public"]["Enums"]["dispute_resolution"]
        }
        Returns: {
          created_at: string
          credit_amount: number | null
          description: string
          evidence_urls: string[]
          id: string
          opened_by: string
          order_id: string
          reason: Database["public"]["Enums"]["dispute_reason"]
          resolution: Database["public"]["Enums"]["dispute_resolution"] | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          store_id: string
        }
        SetofOptions: {
          from: "*"
          to: "disputes"
          isOneToOne: true
          isSetofReturn: false
        }
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
          p_preview_id?: string
          p_product_name?: string
          p_product_url?: string
          p_store_id?: string
          p_supersedes_quote_id?: string
          p_target_countries?: string[]
          p_target_monthly_volume?: number
        }
        Returns: {
          created_at: string
          id: string
          image_urls: string[] | null
          notes: string | null
          preview_id: string | null
          product_name: string | null
          product_url: string
          quote_breach_notified_at: string | null
          quote_due_at: string
          quote_valid_until: string | null
          quoted_at: string | null
          quoted_by: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          store_id: string
          supersedes_quote_id: string | null
          target_countries: string[]
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
          created_at: string
          id: string
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
          store_id: string
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
      dispute_author_role: "client" | "admin"
      dispute_reason: "not_delivered" | "damaged" | "wrong_product"
      dispute_resolution: "wallet_credit" | "reshipped" | "rejected"
      dispute_status:
        | "open"
        | "investigating"
        | "approved"
        | "rejected"
        | "closed"
      document_type: "order_receipt" | "wallet_topup" | "subscription"
      entity_status: "active" | "suspended"
      integration_mode: "automatic" | "manual"
      order_payment_method: "wallet" | "direct"
      order_status:
        | "awaiting_payment"
        | "paid"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "needs_review"
      pricing_tier: "starter" | "growth" | "scale"
      product_status: "active" | "discontinued" | "needs_review"
      product_type: "simple" | "bundle"
      profile_status: "pending" | "active" | "suspended" | "draft"
      provisioning_status: "not_started" | "in_progress" | "complete" | "failed"
      push_status: "pending" | "pushed" | "failed"
      quote_line_status: "pending" | "accepted" | "rejected"
      quote_status: "submitted" | "sourcing" | "quoted" | "closed" | "expired"
      spymarket_plan: "starter" | "plus" | "max"
      store_platform: "shopify" | "woocommerce" | "other"
      subscription_plan: "basic" | "unlimited"
      subscription_status: "none" | "active" | "past_due" | "canceled"
      url_preview_source: "firecrawl" | "fetch" | "perplexity"
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
      dispute_author_role: ["client", "admin"],
      dispute_reason: ["not_delivered", "damaged", "wrong_product"],
      dispute_resolution: ["wallet_credit", "reshipped", "rejected"],
      dispute_status: [
        "open",
        "investigating",
        "approved",
        "rejected",
        "closed",
      ],
      document_type: ["order_receipt", "wallet_topup", "subscription"],
      entity_status: ["active", "suspended"],
      integration_mode: ["automatic", "manual"],
      order_payment_method: ["wallet", "direct"],
      order_status: [
        "awaiting_payment",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "needs_review",
      ],
      pricing_tier: ["starter", "growth", "scale"],
      product_status: ["active", "discontinued", "needs_review"],
      product_type: ["simple", "bundle"],
      profile_status: ["pending", "active", "suspended", "draft"],
      provisioning_status: ["not_started", "in_progress", "complete", "failed"],
      push_status: ["pending", "pushed", "failed"],
      quote_line_status: ["pending", "accepted", "rejected"],
      quote_status: ["submitted", "sourcing", "quoted", "closed", "expired"],
      spymarket_plan: ["starter", "plus", "max"],
      store_platform: ["shopify", "woocommerce", "other"],
      subscription_plan: ["basic", "unlimited"],
      subscription_status: ["none", "active", "past_due", "canceled"],
      url_preview_source: ["firecrawl", "fetch", "perplexity"],
      wallet_txn_type: ["credit", "debit", "adjustment"],
    },
  },
} as const
