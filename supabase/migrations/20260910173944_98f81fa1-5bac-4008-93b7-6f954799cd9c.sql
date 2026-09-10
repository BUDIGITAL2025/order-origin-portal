ALTER TYPE public.stock_purchase_status ADD VALUE IF NOT EXISTS 'po_sent' AFTER 'paid';
ALTER TYPE public.stock_purchase_status ADD VALUE IF NOT EXISTS 'invoice_uploaded' AFTER 'po_sent';
ALTER TYPE public.stock_purchase_status ADD VALUE IF NOT EXISTS 'invoice_verified' AFTER 'invoice_uploaded';
ALTER TYPE public.stock_purchase_status ADD VALUE IF NOT EXISTS 'invoice_discrepancy' AFTER 'invoice_verified';
ALTER TYPE public.stock_purchase_status ADD VALUE IF NOT EXISTS 'supplier_paid' AFTER 'invoice_discrepancy';