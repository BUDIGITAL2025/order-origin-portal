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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          summary: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          summary: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_activation_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          requested_by: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          requested_by?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          requested_by?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_activation_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_activation_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_api_calls: {
        Row: {
          ad_account_id: string | null
          cached: boolean
          called_by: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          ok: boolean
          params_hash: string
          platform: string
          rows_returned: number
          status_code: number | null
          summary: Json
          tool: string
          workspace_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          cached?: boolean
          called_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok: boolean
          params_hash: string
          platform?: string
          rows_returned?: number
          status_code?: number | null
          summary?: Json
          tool: string
          workspace_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          cached?: boolean
          called_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          ok?: boolean
          params_hash?: string
          platform?: string
          rows_returned?: number
          status_code?: number | null
          summary?: Json
          tool?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_api_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_cache: {
        Row: {
          ad_account_id: string | null
          cache_key: string
          expires_at: string
          fetched_at: string
          payload: Json
          tool: string
        }
        Insert: {
          ad_account_id?: string | null
          cache_key: string
          expires_at: string
          fetched_at?: string
          payload: Json
          tool: string
        }
        Update: {
          ad_account_id?: string | null
          cache_key?: string
          expires_at?: string
          fetched_at?: string
          payload?: Json
          tool?: string
        }
        Relationships: []
      }
      ai_calls: {
        Row: {
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          id: string
          model: string
          operation: string
          pages: number | null
          provider: string
          ref_id: string | null
          ref_table: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          model: string
          operation: string
          pages?: number | null
          provider: string
          ref_id?: string | null
          ref_table?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          model?: string
          operation?: string
          pages?: number | null
          provider?: string
          ref_id?: string | null
          ref_table?: string | null
          status?: string
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          created_at: string
          id: string
          job_id: string
          kind: string
          module: string
          payload: Json
          status: string
          storage_ref: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          kind: string
          module: string
          payload?: Json
          status?: string
          storage_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          kind?: string
          module?: string
          payload?: Json
          status?: string
          storage_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
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
      catalog_import_rows: {
        Row: {
          available_qty: number | null
          bbox: Json | null
          color: string | null
          converted_product_id: string | null
          converted_quote_id: string | null
          created_at: string
          description: string | null
          id: string
          image_urls: string[]
          import_id: string
          included: boolean
          inner_qty: number | null
          item_no: string | null
          low_confidence: string[]
          outer_qty: number | null
          packaging: string | null
          page_no: number
          row_ref: string | null
          size_text: string | null
          sort_order: number
          unit_price: number | null
          weight_g: number | null
        }
        Insert: {
          available_qty?: number | null
          bbox?: Json | null
          color?: string | null
          converted_product_id?: string | null
          converted_quote_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          import_id: string
          included?: boolean
          inner_qty?: number | null
          item_no?: string | null
          low_confidence?: string[]
          outer_qty?: number | null
          packaging?: string | null
          page_no?: number
          row_ref?: string | null
          size_text?: string | null
          sort_order?: number
          unit_price?: number | null
          weight_g?: number | null
        }
        Update: {
          available_qty?: number | null
          bbox?: Json | null
          color?: string | null
          converted_product_id?: string | null
          converted_quote_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[]
          import_id?: string
          included?: boolean
          inner_qty?: number | null
          item_no?: string | null
          low_confidence?: string[]
          outer_qty?: number | null
          packaging?: string | null
          page_no?: number
          row_ref?: string | null
          size_text?: string | null
          sort_order?: number
          unit_price?: number | null
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_import_rows_converted_product_id_fkey"
            columns: ["converted_product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "catalog_import_rows_converted_product_id_fkey"
            columns: ["converted_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_import_rows_converted_quote_id_fkey"
            columns: ["converted_quote_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "catalog_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_imports: {
        Row: {
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string
          model: string | null
          page_count: number
          raw_response: string | null
          status: string
          store_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type: string
          model?: string | null
          page_count?: number
          raw_response?: string | null
          status?: string
          store_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string
          model?: string | null
          page_count?: number
          raw_response?: string | null
          status?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_imports_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
      email_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          provider_message_id: string | null
          related_id: string | null
          status: string
          subject: string
          to_address: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          provider_message_id?: string | null
          related_id?: string | null
          status: string
          subject: string
          to_address: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          provider_message_id?: string | null
          related_id?: string | null
          status?: string
          subject?: string
          to_address?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          account_id: string
          address: string | null
          address_line1: string | null
          address_line2: string | null
          archived_at: string | null
          auto_topup_amount: number | null
          auto_topup_enabled: boolean
          auto_topup_threshold: number | null
          cancel_notice_sent_at: string | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          city: string | null
          country: string | null
          created_at: string
          default_payment_method_id: string | null
          id: string
          legal_name: string
          max_stores: number
          postal_code: string | null
          status: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id: string | null
          tax_id: string | null
          vat_number: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          cancel_notice_sent_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          legal_name: string
          max_stores?: number
          postal_code?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id?: string | null
          tax_id?: string | null
          vat_number?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          archived_at?: string | null
          auto_topup_amount?: number | null
          auto_topup_enabled?: boolean
          auto_topup_threshold?: number | null
          cancel_notice_sent_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          legal_name?: string
          max_stores?: number
          postal_code?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          stripe_customer_id?: string | null
          tax_id?: string | null
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
      inbound_shipment_lines: {
        Row: {
          counted_qty: number | null
          created_at: string
          declared_qty: number
          id: string
          product_id: string | null
          product_name: string
          shipment_id: string
          sku: string
        }
        Insert: {
          counted_qty?: number | null
          created_at?: string
          declared_qty: number
          id?: string
          product_id?: string | null
          product_name: string
          shipment_id: string
          sku: string
        }
        Update: {
          counted_qty?: number | null
          created_at?: string
          declared_qty?: number
          id?: string
          product_id?: string | null
          product_name?: string
          shipment_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "inbound_shipment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_shipment_lines_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "inbound_shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_shipments: {
        Row: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        Insert: {
          archived_at?: string | null
          completed_at?: string | null
          counted_cartons?: number | null
          counted_pieces?: number | null
          created_at?: string
          created_by?: string | null
          declared_cartons?: number | null
          declared_pieces?: number
          entity_id: string
          expected_arrival_date?: string | null
          fee_charged?: number | null
          has_discrepancy?: boolean
          id?: string
          in_transit_at?: string | null
          qc?: boolean
          qc_fee_per_piece?: number
          received_at?: string | null
          refusal_reason?: string | null
          service_fee_per_piece?: number
          source?: string
          status?: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id?: string | null
          store_id: string
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          wallet_reference?: string | null
          warehouse_reference?: string
        }
        Update: {
          archived_at?: string | null
          completed_at?: string | null
          counted_cartons?: number | null
          counted_pieces?: number | null
          created_at?: string
          created_by?: string | null
          declared_cartons?: number | null
          declared_pieces?: number
          entity_id?: string
          expected_arrival_date?: string | null
          fee_charged?: number | null
          has_discrepancy?: boolean
          id?: string
          in_transit_at?: string | null
          qc?: boolean
          qc_fee_per_piece?: number
          received_at?: string | null
          refusal_reason?: string | null
          service_fee_per_piece?: number
          source?: string
          status?: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id?: string | null
          store_id?: string
          tracking_carrier?: string | null
          tracking_number?: string | null
          updated_at?: string
          wallet_reference?: string | null
          warehouse_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_shipments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_shipments_stock_purchase_id_fkey"
            columns: ["stock_purchase_id"]
            isOneToOne: false
            referencedRelation: "stock_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_shipments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_calls: {
        Row: {
          created_at: string
          direction: string
          endpoint: string
          error: string | null
          id: string
          idempotency_key: string | null
          ok: boolean
          simulator: boolean
          status_code: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          endpoint: string
          error?: string | null
          id?: string
          idempotency_key?: string | null
          ok?: boolean
          simulator?: boolean
          status_code?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          endpoint?: string
          error?: string | null
          id?: string
          idempotency_key?: string | null
          ok?: boolean
          simulator?: boolean
          status_code?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      integration_events: {
        Row: {
          created_at: string
          entry_path: string
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          signature_valid: boolean
          simulator: boolean
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          entry_path?: string
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          signature_valid?: boolean
          simulator?: boolean
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          entry_path?: string
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          signature_valid?: boolean
          simulator?: boolean
          tenant_id?: string | null
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
      inventory_snapshots: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          location: string
          quantity: number
          sku: string
          store_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          location?: string
          quantity?: number
          sku: string
          store_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          location?: string
          quantity?: number
          sku?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_snapshots_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          lease_until: string | null
          module: string
          params: Json
          phase: string | null
          progress_pct: number
          started_at: string | null
          status: string
          total_cost: number
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          lease_until?: string | null
          module: string
          params?: Json
          phase?: string | null
          progress_pct?: number
          started_at?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          lease_until?: string | null
          module?: string
          params?: Json
          phase?: string | null
          progress_pct?: number
          started_at?: string | null
          status?: string
          total_cost?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_stock_levels: {
        Row: {
          created_at: string
          id: string
          in_warehouse: number
          incoming: number
          locations: Json
          reserved: number
          sku: string
          stock_set_at: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_warehouse?: number
          incoming?: number
          locations?: Json
          reserved?: number
          sku: string
          stock_set_at?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          in_warehouse?: number
          incoming?: number
          locations?: Json
          reserved?: number
          sku?: string
          stock_set_at?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_stock_levels_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      middleware_sync_state: {
        Row: {
          consecutive_failures: number
          created_at: string
          first_failure_at: string | null
          last_error: string | null
          last_seen_order_ids: string[]
          last_success_at: string | null
          last_synced_at: string | null
          orders_ingested: number
          sample_logged: boolean
          store_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          first_failure_at?: string | null
          last_error?: string | null
          last_seen_order_ids?: string[]
          last_success_at?: string | null
          last_synced_at?: string | null
          orders_ingested?: number
          sample_logged?: boolean
          store_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          first_failure_at?: string | null
          last_error?: string | null
          last_seen_order_ids?: string[]
          last_success_at?: string | null
          last_synced_at?: string | null
          orders_ingested?: number
          sample_logged?: boolean
          store_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "middleware_sync_state_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
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
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount: number | null
          tracking_carrier: string | null
          tracking_notified_at: string | null
          tracking_number: string | null
        }
        Insert: {
          archived_at?: string | null
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
          release_attempts?: number
          release_error?: string | null
          release_last_attempt_at?: string | null
          release_sent_at?: string | null
          release_status?: string | null
          reminder_24_sent_at?: string | null
          reminder_48_sent_at?: string | null
          reminder_72_sent_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_amount?: number | null
          tracking_carrier?: string | null
          tracking_notified_at?: string | null
          tracking_number?: string | null
        }
        Update: {
          archived_at?: string | null
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
          release_attempts?: number
          release_error?: string | null
          release_last_attempt_at?: string | null
          release_sent_at?: string | null
          release_status?: string | null
          reminder_24_sent_at?: string | null
          reminder_48_sent_at?: string | null
          reminder_72_sent_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          source?: string
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
      product_shipping_routes: {
        Row: {
          created_at: string
          destination: string
          handling_time_days: number
          id: string
          is_default: boolean
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination: string
          handling_time_days?: number
          id?: string
          is_default?: boolean
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination?: string
          handling_time_days?: number
          id?: string
          is_default?: boolean
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_shipping_routes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "product_shipping_routes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          client_owned: boolean
          created_at: string
          fulfilment_model: Database["public"]["Enums"]["fulfilment_model"]
          id: string
          image_url: string | null
          image_urls: string[]
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          production_lead_days: number | null
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          safety_margin_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id: string | null
          tags: string[]
          transit_lead_days: number | null
          variant_label: string | null
          weight: number | null
          weight_grams: number | null
          weight_unit: string | null
        }
        Insert: {
          archived_at?: string | null
          client_owned?: boolean
          created_at?: string
          fulfilment_model?: Database["public"]["Enums"]["fulfilment_model"]
          id?: string
          image_url?: string | null
          image_urls?: string[]
          middleware_product_id?: string | null
          moq?: number | null
          price_override?: number | null
          product_name: string
          product_type?: Database["public"]["Enums"]["product_type"]
          production_lead_days?: number | null
          push_error?: string | null
          push_status?: Database["public"]["Enums"]["push_status"]
          quote_line_id?: string | null
          safety_margin_days?: number | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id?: string | null
          tags?: string[]
          transit_lead_days?: number | null
          variant_label?: string | null
          weight?: number | null
          weight_grams?: number | null
          weight_unit?: string | null
        }
        Update: {
          archived_at?: string | null
          client_owned?: boolean
          created_at?: string
          fulfilment_model?: Database["public"]["Enums"]["fulfilment_model"]
          id?: string
          image_url?: string | null
          image_urls?: string[]
          middleware_product_id?: string | null
          moq?: number | null
          price_override?: number | null
          product_name?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          production_lead_days?: number | null
          push_error?: string | null
          push_status?: Database["public"]["Enums"]["push_status"]
          quote_line_id?: string | null
          safety_margin_days?: number | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          store_id?: string
          supplier_id?: string | null
          tags?: string[]
          transit_lead_days?: number | null
          variant_label?: string | null
          weight?: number | null
          weight_grams?: number | null
          weight_unit?: string | null
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
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
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
          archived_at?: string | null
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
          archived_at?: string | null
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
      quote_intents: {
        Row: {
          created_at: string
          created_by: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          payload: Json
          quote_request_id: string
          status: string
          store_id: string | null
          type: Database["public"]["Enums"]["quote_intent_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          payload?: Json
          quote_request_id: string
          status?: string
          store_id?: string | null
          type: Database["public"]["Enums"]["quote_intent_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          payload?: Json
          quote_request_id?: string
          status?: string
          store_id?: string | null
          type?: Database["public"]["Enums"]["quote_intent_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_intents_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_intents_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          country_code: string
          created_at: string
          fee_included: boolean
          id: string
          lead_time_days: number | null
          margin_pct: number
          moq: number | null
          option_id: string | null
          production_lead_days: number | null
          quote_request_id: string
          responded_at: string | null
          sku: string
          sourced_at: string | null
          sourced_by: string | null
          sourcing_cost: number | null
          sourcing_fee_rate: number | null
          sourcing_image_urls: string[]
          sourcing_notes: string | null
          status: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs: number | null
          supplier_id: string | null
          supplier_shipping: number | null
          supplier_tax: number | null
          supplier_unit_price: number | null
          unit_price: number | null
          variant_label: string
        }
        Insert: {
          country_code: string
          created_at?: string
          fee_included?: boolean
          id?: string
          lead_time_days?: number | null
          margin_pct?: number
          moq?: number | null
          option_id?: string | null
          production_lead_days?: number | null
          quote_request_id: string
          responded_at?: string | null
          sku: string
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_cost?: number | null
          sourcing_fee_rate?: number | null
          sourcing_image_urls?: string[]
          sourcing_notes?: string | null
          status?: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs?: number | null
          supplier_id?: string | null
          supplier_shipping?: number | null
          supplier_tax?: number | null
          supplier_unit_price?: number | null
          unit_price?: number | null
          variant_label: string
        }
        Update: {
          country_code?: string
          created_at?: string
          fee_included?: boolean
          id?: string
          lead_time_days?: number | null
          margin_pct?: number
          moq?: number | null
          option_id?: string | null
          production_lead_days?: number | null
          quote_request_id?: string
          responded_at?: string | null
          sku?: string
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_cost?: number | null
          sourcing_fee_rate?: number | null
          sourcing_image_urls?: string[]
          sourcing_notes?: string | null
          status?: Database["public"]["Enums"]["quote_line_status"]
          supplier_cogs?: number | null
          supplier_id?: string | null
          supplier_shipping?: number | null
          supplier_tax?: number | null
          supplier_unit_price?: number | null
          unit_price?: number | null
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "quote_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_messages: {
        Row: {
          attachments: string[]
          author_role: string
          author_user_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          pinned: boolean
          quote_request_id: string
          read_by_admin_at: string | null
          read_by_client_at: string | null
          read_by_sourcer_at: string | null
          system_code: string | null
        }
        Insert: {
          attachments?: string[]
          author_role: string
          author_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          pinned?: boolean
          quote_request_id: string
          read_by_admin_at?: string | null
          read_by_client_at?: string | null
          read_by_sourcer_at?: string | null
          system_code?: string | null
        }
        Update: {
          attachments?: string[]
          author_role?: string
          author_user_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          pinned?: boolean
          quote_request_id?: string
          read_by_admin_at?: string | null
          read_by_client_at?: string | null
          read_by_sourcer_at?: string | null
          system_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_messages_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_options: {
        Row: {
          accepted_at: string | null
          archived_at: string | null
          created_at: string
          id: string
          internal_notes: string | null
          letter: string
          margin_pct: number
          moq: number | null
          production_lead_days: number | null
          published: boolean
          quality: number
          quote_request_id: string
          recommended: boolean
          shipping_lead_days: number | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          internal_notes?: string | null
          letter: string
          margin_pct?: number
          moq?: number | null
          production_lead_days?: number | null
          published?: boolean
          quality?: number
          quote_request_id: string
          recommended?: boolean
          shipping_lead_days?: number | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          archived_at?: string | null
          created_at?: string
          id?: string
          internal_notes?: string | null
          letter?: string
          margin_pct?: number
          moq?: number | null
          production_lead_days?: number | null
          published?: boolean
          quality?: number
          quote_request_id?: string
          recommended?: boolean
          shipping_lead_days?: number | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_options_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_options_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
          archived_at: string | null
          assigned_sourcer: string | null
          client_site: boolean
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
          sourcing_submitted_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          store_id: string
          supersedes_quote_id: string | null
          target_countries: string[]
          target_monthly_volume: number | null
        }
        Insert: {
          archived_at?: string | null
          assigned_sourcer?: string | null
          client_site?: boolean
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
          sourcing_submitted_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          store_id: string
          supersedes_quote_id?: string | null
          target_countries: string[]
          target_monthly_volume?: number | null
        }
        Update: {
          archived_at?: string | null
          assigned_sourcer?: string | null
          client_site?: boolean
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
          sourcing_submitted_at?: string | null
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
      seo_api_calls: {
        Row: {
          cached: boolean
          called_by: string | null
          cost: number
          created_at: string
          duration_ms: number | null
          endpoint: string
          id: string
          payload_hash: string
          status: string
          summary: Json
        }
        Insert: {
          cached?: boolean
          called_by?: string | null
          cost?: number
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          id?: string
          payload_hash: string
          status?: string
          summary?: Json
        }
        Update: {
          cached?: boolean
          called_by?: string | null
          cost?: number
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          id?: string
          payload_hash?: string
          status?: string
          summary?: Json
        }
        Relationships: []
      }
      seo_cache: {
        Row: {
          created_at: string
          endpoint: string
          expires_at: string
          id: string
          payload_hash: string
          response: Json
        }
        Insert: {
          created_at?: string
          endpoint: string
          expires_at: string
          id?: string
          payload_hash: string
          response: Json
        }
        Update: {
          created_at?: string
          endpoint?: string
          expires_at?: string
          id?: string
          payload_hash?: string
          response?: Json
        }
        Relationships: []
      }
      simulator_calls: {
        Row: {
          action: string
          created_at: string
          endpoint: string
          id: string
          idempotency_key: string
          payload: Json | null
          replay_count: number
          response: Json | null
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          endpoint: string
          id?: string
          idempotency_key: string
          payload?: Json | null
          replay_count?: number
          response?: Json | null
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          endpoint?: string
          id?: string
          idempotency_key?: string
          payload?: Json | null
          replay_count?: number
          response?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      sku_alert_state: {
        Row: {
          created_at: string
          id: string
          notified_at: string | null
          sku: string
          state: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notified_at?: string | null
          sku: string
          state: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notified_at?: string | null
          sku?: string
          state?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_alert_state_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_velocity: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          sku: string
          store_id: string
          units_30d: number
          units_7d: number
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          sku: string
          store_id: string
          units_30d?: number
          units_7d?: number
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          sku?: string
          store_id?: string
          units_30d?: number
          units_7d?: number
        }
        Relationships: [
          {
            foreignKeyName: "sku_velocity_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sourcing_collaborators: {
        Row: {
          active: boolean
          created_at: string
          display_name: string | null
          email: string
          fee_rate: number
          id: string
          invite_last_sent_at: string | null
          invited_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email: string
          fee_rate?: number
          id?: string
          invite_last_sent_at?: string | null
          invited_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string
          fee_rate?: number
          id?: string
          invite_last_sent_at?: string | null
          invited_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sourcing_earnings: {
        Row: {
          accrued_at: string
          amount: number
          collaborator_user_id: string
          created_at: string
          description: string
          fee_rate: number
          id: string
          order_id: string | null
          quote_line_id: string | null
          reference: string
          settled: boolean
          settled_at: string | null
          stock_purchase_id: string | null
          supplier_unit_price: number
          units: number
        }
        Insert: {
          accrued_at?: string
          amount: number
          collaborator_user_id: string
          created_at?: string
          description: string
          fee_rate: number
          id?: string
          order_id?: string | null
          quote_line_id?: string | null
          reference: string
          settled?: boolean
          settled_at?: string | null
          stock_purchase_id?: string | null
          supplier_unit_price: number
          units: number
        }
        Update: {
          accrued_at?: string
          amount?: number
          collaborator_user_id?: string
          created_at?: string
          description?: string
          fee_rate?: number
          id?: string
          order_id?: string | null
          quote_line_id?: string | null
          reference?: string
          settled?: boolean
          settled_at?: string | null
          stock_purchase_id?: string | null
          supplier_unit_price?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "sourcing_earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_earnings_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sourcing_earnings_stock_purchase_id_fkey"
            columns: ["stock_purchase_id"]
            isOneToOne: false
            referencedRelation: "stock_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      spy_api_calls: {
        Row: {
          cached: boolean
          called_by: string | null
          created_at: string
          credits_cost: number
          credits_remaining: number | null
          duration_ms: number | null
          endpoint: string
          error: string | null
          id: string
          ok: boolean
          provider: string
          rows_returned: number
          status_code: number | null
          summary: Json
        }
        Insert: {
          cached?: boolean
          called_by?: string | null
          created_at?: string
          credits_cost?: number
          credits_remaining?: number | null
          duration_ms?: number | null
          endpoint: string
          error?: string | null
          id?: string
          ok?: boolean
          provider: string
          rows_returned?: number
          status_code?: number | null
          summary?: Json
        }
        Update: {
          cached?: boolean
          called_by?: string | null
          created_at?: string
          credits_cost?: number
          credits_remaining?: number | null
          duration_ms?: number | null
          endpoint?: string
          error?: string | null
          id?: string
          ok?: boolean
          provider?: string
          rows_returned?: number
          status_code?: number | null
          summary?: Json
        }
        Relationships: []
      }
      spymarket_cache: {
        Row: {
          cache_key: string
          endpoint: string
          fetched_at: string
          payload: Json
          provider: string
        }
        Insert: {
          cache_key: string
          endpoint: string
          fetched_at?: string
          payload: Json
          provider?: string
        }
        Update: {
          cache_key?: string
          endpoint?: string
          fetched_at?: string
          payload?: Json
          provider?: string
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
      stock_in_prices: {
        Row: {
          country_code: string
          created_at: string
          fulfilment_fee: number
          id: string
          product_id: string
          shipping_price: number
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          fulfilment_fee?: number
          id?: string
          product_id: string
          shipping_price?: number
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          fulfilment_fee?: number
          id?: string
          product_id?: string
          shipping_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_in_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "stock_in_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_purchases: {
        Row: {
          admin_notes: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          delivery_address: Json | null
          entity_id: string
          freight_cost: number | null
          freight_quoted_at: string | null
          goods_total: number
          id: string
          import_cost: number | null
          in_production_at: string | null
          inbound_shipment_id: string | null
          paid_at: string | null
          path: Database["public"]["Enums"]["stock_purchase_path"]
          product_id: string | null
          product_name: string
          quantity: number
          quote_line_id: string | null
          quote_request_id: string | null
          shipped_at: string | null
          sku: string | null
          sourced_by: string | null
          sourcing_fee_rate: number | null
          status: Database["public"]["Enums"]["stock_purchase_status"]
          store_id: string
          supplier_unit_price: number | null
          total_amount: number | null
          tracking_carrier: string | null
          tracking_number: string | null
          unit_price: number
          updated_at: string
          variant_label: string | null
          wallet_reference: string | null
        }
        Insert: {
          admin_notes?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivery_address?: Json | null
          entity_id: string
          freight_cost?: number | null
          freight_quoted_at?: string | null
          goods_total: number
          id?: string
          import_cost?: number | null
          in_production_at?: string | null
          inbound_shipment_id?: string | null
          paid_at?: string | null
          path: Database["public"]["Enums"]["stock_purchase_path"]
          product_id?: string | null
          product_name: string
          quantity: number
          quote_line_id?: string | null
          quote_request_id?: string | null
          shipped_at?: string | null
          sku?: string | null
          sourced_by?: string | null
          sourcing_fee_rate?: number | null
          status?: Database["public"]["Enums"]["stock_purchase_status"]
          store_id: string
          supplier_unit_price?: number | null
          total_amount?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          unit_price: number
          updated_at?: string
          variant_label?: string | null
          wallet_reference?: string | null
        }
        Update: {
          admin_notes?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivery_address?: Json | null
          entity_id?: string
          freight_cost?: number | null
          freight_quoted_at?: string | null
          goods_total?: number
          id?: string
          import_cost?: number | null
          in_production_at?: string | null
          inbound_shipment_id?: string | null
          paid_at?: string | null
          path?: Database["public"]["Enums"]["stock_purchase_path"]
          product_id?: string | null
          product_name?: string
          quantity?: number
          quote_line_id?: string | null
          quote_request_id?: string | null
          shipped_at?: string | null
          sku?: string | null
          sourced_by?: string | null
          sourcing_fee_rate?: number | null
          status?: Database["public"]["Enums"]["stock_purchase_status"]
          store_id?: string
          supplier_unit_price?: number | null
          total_amount?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          unit_price?: number
          updated_at?: string
          variant_label?: string | null
          wallet_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_inbound_fkey"
            columns: ["inbound_shipment_id"]
            isOneToOne: false
            referencedRelation: "inbound_shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bundle_prices"
            referencedColumns: ["bundle_product_id"]
          },
          {
            foreignKeyName: "stock_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_quote_line_id_fkey"
            columns: ["quote_line_id"]
            isOneToOne: false
            referencedRelation: "quote_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_purchases_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          approved_at: string | null
          avg_daily_units_30d: number
          created_at: string
          default_production_lead_days: number
          default_safety_margin_days: number
          default_transit_lead_days: number
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
          default_production_lead_days?: number
          default_safety_margin_days?: number
          default_transit_lead_days?: number
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
          default_production_lead_days?: number
          default_safety_margin_days?: number
          default_transit_lead_days?: number
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
      suppliers: {
        Row: {
          active: boolean
          created_at: string
          default_production_lead_days: number | null
          default_transit_lead_days: number | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_production_lead_days?: number | null
          default_transit_lead_days?: number | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_production_lead_days?: number | null
          default_transit_lead_days?: number | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
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
      workspace_ad_accounts: {
        Row: {
          active: boolean
          ad_account_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          platform: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          ad_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          platform?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          ad_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          platform?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_ad_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_ad_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
      accept_quote_option: {
        Args: { p_option_id: string; p_product_name: string }
        Returns: number
      }
      admin_confirm_inbound_receipt: {
        Args: {
          p_counted_cartons?: number
          p_counts: Json
          p_shipment_id: string
        }
        Returns: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_refuse_inbound: {
        Args: { p_reason: string; p_shipment_id: string }
        Returns: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_resolve_order_item: {
        Args: { p_item_id: string; p_product_id: string }
        Returns: {
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
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
          default_production_lead_days: number
          default_safety_margin_days: number
          default_transit_lead_days: number
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
          archived_at: string | null
          client_owned: boolean
          created_at: string
          fulfilment_model: Database["public"]["Enums"]["fulfilment_model"]
          id: string
          image_url: string | null
          image_urls: string[]
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          production_lead_days: number | null
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          safety_margin_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id: string | null
          tags: string[]
          transit_lead_days: number | null
          variant_label: string | null
          weight: number | null
          weight_grams: number | null
          weight_unit: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client_product: {
        Args: {
          p_image_urls?: string[]
          p_name: string
          p_store_id: string
          p_variants: Json
        }
        Returns: {
          archived_at: string | null
          client_owned: boolean
          created_at: string
          fulfilment_model: Database["public"]["Enums"]["fulfilment_model"]
          id: string
          image_url: string | null
          image_urls: string[]
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          production_lead_days: number | null
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          safety_margin_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id: string | null
          tags: string[]
          transit_lead_days: number | null
          variant_label: string | null
          weight: number | null
          weight_grams: number | null
          weight_unit: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
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
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
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
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
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
      declare_inbound_shipment: {
        Args: {
          p_cartons?: number
          p_expected_arrival?: string
          p_lines: Json
          p_qc: boolean
          p_store_id: string
        }
        Returns: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      detect_client_site: {
        Args: { p_store_id: string; p_url: string }
        Returns: boolean
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
      ingest_middleware_order: {
        Args: {
          p_destination_country: string
          p_external_ref: string
          p_line_items: Json
          p_middleware_order_id: string
          p_shipping_address: Json
          p_tenant_id: string
        }
        Returns: {
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
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
          archived_at: string | null
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
          release_attempts: number
          release_error: string | null
          release_last_attempt_at: string | null
          release_sent_at: string | null
          release_status: string | null
          reminder_24_sent_at: string | null
          reminder_48_sent_at: string | null
          reminder_72_sent_at: string | null
          shipped_at: string | null
          shipping_address: Json | null
          source: string
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
      is_assigned_sourcer: { Args: { p_quote: string }; Returns: boolean }
      is_sourcing: { Args: { _user_id: string }; Returns: boolean }
      manual_stock_units_sold_since: {
        Args: { p_store_id: string }
        Returns: {
          sku: string
          units_sold: number
        }[]
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
      owns_quote: { Args: { p_quote: string }; Returns: boolean }
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
      recompute_sku_velocity: { Args: { p_store_id: string }; Returns: number }
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
      resolved_lead_times: {
        Args: { p_store_id: string }
        Returns: {
          product_id: string
          product_name: string
          production_lead: number
          production_origin: string
          safety_margin: number
          safety_origin: string
          sku: string
          transit_lead: number
          transit_origin: string
        }[]
      }
      respond_to_quote_lines: {
        Args: { p_decisions: Json; p_product_name: string; p_quote_id: string }
        Returns: number
      }
      set_inbound_expected_arrival: {
        Args: {
          p_cartons?: number
          p_expected_arrival: string
          p_shipment_id: string
        }
        Returns: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_inbound_tracking: {
        Args: {
          p_shipment_id: string
          p_tracking_carrier: string
          p_tracking_number: string
        }
        Returns: {
          archived_at: string | null
          completed_at: string | null
          counted_cartons: number | null
          counted_pieces: number | null
          created_at: string
          created_by: string | null
          declared_cartons: number | null
          declared_pieces: number
          entity_id: string
          expected_arrival_date: string | null
          fee_charged: number | null
          has_discrepancy: boolean
          id: string
          in_transit_at: string | null
          qc: boolean
          qc_fee_per_piece: number
          received_at: string | null
          refusal_reason: string | null
          service_fee_per_piece: number
          source: string
          status: Database["public"]["Enums"]["inbound_status"]
          stock_purchase_id: string | null
          store_id: string
          tracking_carrier: string | null
          tracking_number: string | null
          updated_at: string
          wallet_reference: string | null
          warehouse_reference: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stock_in_available: {
        Args: { p_sku: string; p_store_id: string }
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
          archived_at: string | null
          assigned_sourcer: string | null
          client_site: boolean
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
          sourcing_submitted_at: string | null
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
          archived_at: string | null
          client_owned: boolean
          created_at: string
          fulfilment_model: Database["public"]["Enums"]["fulfilment_model"]
          id: string
          image_url: string | null
          image_urls: string[]
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          production_lead_days: number | null
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          safety_margin_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id: string | null
          tags: string[]
          transit_lead_days: number | null
          variant_label: string | null
          weight: number | null
          weight_grams: number | null
          weight_unit: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_manual_inventory_item: {
        Args: {
          p_image_url?: string
          p_incoming: number
          p_lead_time_days: number
          p_product_name: string
          p_reserved: number
          p_routes: Json
          p_sku: string
          p_store_id: string
          p_tags: string[]
          p_warehouses: Json
          p_weight: number
          p_weight_unit: string
        }
        Returns: {
          archived_at: string | null
          client_owned: boolean
          created_at: string
          fulfilment_model: Database["public"]["Enums"]["fulfilment_model"]
          id: string
          image_url: string | null
          image_urls: string[]
          middleware_product_id: string | null
          moq: number | null
          price_override: number | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          production_lead_days: number | null
          push_error: string | null
          push_status: Database["public"]["Enums"]["push_status"]
          quote_line_id: string | null
          safety_margin_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          store_id: string
          supplier_id: string | null
          tags: string[]
          transit_lead_days: number | null
          variant_label: string | null
          weight: number | null
          weight_grams: number | null
          weight_unit: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      url_host: { Args: { p_url: string }; Returns: string }
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
      document_type:
        | "order_receipt"
        | "wallet_topup"
        | "subscription"
        | "inbound_fee"
        | "stock_purchase"
      entity_status: "active" | "suspended"
      fulfilment_model: "per_order" | "stock_in"
      inbound_status:
        | "declared"
        | "in_transit"
        | "received"
        | "completed"
        | "refused"
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
      quote_intent_type:
        | "price_too_high"
        | "add_country"
        | "size_chart"
        | "factory_photos"
        | "materials_list"
        | "new_variant"
        | "stop_quoting"
        | "need_product_details"
      quote_line_status: "pending" | "accepted" | "rejected"
      quote_status: "submitted" | "sourcing" | "quoted" | "closed" | "expired"
      spymarket_plan: "starter" | "plus" | "max" | "module"
      stock_purchase_path: "flysales" | "direct"
      stock_purchase_status:
        | "requested"
        | "freight_quoted"
        | "paid"
        | "in_production"
        | "shipped"
        | "delivered"
        | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      document_type: [
        "order_receipt",
        "wallet_topup",
        "subscription",
        "inbound_fee",
        "stock_purchase",
      ],
      entity_status: ["active", "suspended"],
      fulfilment_model: ["per_order", "stock_in"],
      inbound_status: [
        "declared",
        "in_transit",
        "received",
        "completed",
        "refused",
      ],
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
      quote_intent_type: [
        "price_too_high",
        "add_country",
        "size_chart",
        "factory_photos",
        "materials_list",
        "new_variant",
        "stop_quoting",
        "need_product_details",
      ],
      quote_line_status: ["pending", "accepted", "rejected"],
      quote_status: ["submitted", "sourcing", "quoted", "closed", "expired"],
      spymarket_plan: ["starter", "plus", "max", "module"],
      stock_purchase_path: ["flysales", "direct"],
      stock_purchase_status: [
        "requested",
        "freight_quoted",
        "paid",
        "in_production",
        "shipped",
        "delivered",
        "cancelled",
      ],
      store_platform: ["shopify", "woocommerce", "other"],
      subscription_plan: ["basic", "unlimited"],
      subscription_status: ["none", "active", "past_due", "canceled"],
      url_preview_source: ["firecrawl", "fetch", "perplexity"],
      wallet_txn_type: ["credit", "debit", "adjustment"],
    },
  },
} as const
