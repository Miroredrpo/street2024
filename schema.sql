-- Users table is handled by Supabase Auth (auth.users), but we might want a public profile or roles table.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'user'::text,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Trigger to create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'user');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Coupons Table
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for Coupons
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coupons are viewable by everyone." ON public.coupons FOR SELECT USING (true);
CREATE POLICY "Coupons are modifiable by admins." ON public.coupons FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Catalogs Table
CREATE TABLE IF NOT EXISTS public.catalogs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Catalogs are viewable by everyone." ON public.catalogs FOR SELECT USING (true);
CREATE POLICY "Catalogs are modifiable by admins." ON public.catalogs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  catalog_id UUID REFERENCES public.catalogs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  price_inr DECIMAL(10, 2) DEFAULT 0.00,
  show_low_stock_label BOOLEAN DEFAULT false,
  image_url TEXT,
  images TEXT[] DEFAULT '{}',
  sizes TEXT[] DEFAULT '{}',
  stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id TEXT,
  full_name TEXT,
  email TEXT,
  instagram_username TEXT,
  country TEXT,
  state TEXT,
  zipcode TEXT,
  total_amount DECIMAL(10, 2) NOT NULL,
  order_number TEXT UNIQUE,
  status TEXT DEFAULT 'pending'::text, -- pending, shipped, delivered, cancelled
  payment_method TEXT DEFAULT 'cash_on_delivery'::text,
  payment_receipt_url TEXT,
  shipping_address TEXT NOT NULL,
  contact_number TEXT,
  alternate_contact_number TEXT,
  custom_message TEXT,
  province TEXT,
  district TEXT,
  city TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Fast lookup for Instagram-based tracking
CREATE INDEX IF NOT EXISTS idx_orders_instagram_username ON public.orders (instagram_username);

-- Order Items Table
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  size TEXT,
  quantity INTEGER NOT NULL,
  price_at_time DECIMAL(10, 2) NOT NULL
);

-- Cart Items Table
CREATE TABLE IF NOT EXISTS public.cart_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id TEXT NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  size TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(session_id, product_id)
);

-- RLS setup (simplified for now)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Products are viewable by everyone." ON public.products FOR SELECT USING (true);
CREATE POLICY "Products are insertable by admins." ON public.products FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Products are updatable by admins." ON public.products FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own orders." ON public.orders FOR SELECT USING (true);
-- Admins can view all orders
CREATE POLICY "Admins can view all orders." ON public.orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can create their own orders." ON public.orders FOR INSERT WITH CHECK (true);
-- Admins can update orders
CREATE POLICY "Admins can update orders." ON public.orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own order items." ON public.order_items FOR SELECT USING (true);
CREATE POLICY "Admins can view all order items." ON public.order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can create order items for their orders." ON public.order_items FOR INSERT WITH CHECK (true);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own cart." ON public.cart_items FOR SELECT USING (true);
CREATE POLICY "Users can insert into their own cart." ON public.cart_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own cart." ON public.cart_items FOR UPDATE USING (true);
CREATE POLICY "Users can delete from their own cart." ON public.cart_items FOR DELETE USING (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);


-- Safe alter commands if running on existing database
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.products ADD COLUMN price_inr DECIMAL(10, 2) DEFAULT 0.00;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
      ALTER TABLE public.products ADD COLUMN show_low_stock_label BOOLEAN DEFAULT false;
    EXCEPTION
      WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.products ADD COLUMN catalog_id UUID REFERENCES public.catalogs(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.orders ADD COLUMN full_name TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.orders ADD COLUMN email TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.orders ADD COLUMN instagram_username TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
      ALTER TABLE public.orders ADD COLUMN country TEXT;
    EXCEPTION
      WHEN duplicate_column THEN null;
    END;

    BEGIN
      ALTER TABLE public.orders ADD COLUMN state TEXT;
    EXCEPTION
      WHEN duplicate_column THEN null;
    END;

    BEGIN
      ALTER TABLE public.orders ADD COLUMN zipcode TEXT;
    EXCEPTION
      WHEN duplicate_column THEN null;
    END;
END $$;
