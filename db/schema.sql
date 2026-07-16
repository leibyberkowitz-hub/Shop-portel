-- Fish Shop Manager schema (PostgreSQL).
-- Idempotent: safe to run more than once. Already applied to the production
-- Supabase project as migration `fish_shop_initial_schema`; kept here for
-- local/test databases and future environments.

create table if not exists customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null unique,
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null,
  unit text not null default 'lb',
  price numeric(10,2) not null default 0,
  active boolean not null default true
);

create table if not exists orders (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id),
  type text not null default 'pickup' check (type in ('pickup', 'delivery')),
  status text not null default 'new' check (status in
    ('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'cancelled')),
  due_date text not null default '',
  time_slot text not null default '',
  address text not null default '',
  notes text not null default '',
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint references products(id),
  name text not null,
  quantity numeric(10,3) not null default 1,
  unit text not null default 'lb',
  unit_price numeric(10,2) not null default 0,
  line_total numeric(10,2) not null default 0
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  customer_id bigint references customers(id),
  order_id bigint references orders(id),
  phone text not null,
  body text not null,
  status text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null default ''
);

create table if not exists users (
  id bigint generated always as identity primary key,
  username text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_due_date on orders(due_date);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_messages_order on messages(order_id);

-- The app talks to Postgres directly with server-side credentials. RLS with
-- no policies blocks Supabase's PostgREST API roles (anon/authenticated)
-- from touching the data.
alter table customers enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table messages enable row level security;
alter table settings enable row level security;
alter table users enable row level security;

insert into settings (key, value) values
  ('shop_name', 'The Fish Shop'),
  ('auto_sms', '1'),
  ('sms_confirmed', 'Hi {name}, your order #{order} from {shop} is confirmed. Total: £{total}. {when}We will text you with updates.'),
  ('sms_ready', 'Hi {name}, your order #{order} from {shop} is ready for pickup! Total: £{total}.'),
  ('sms_out_for_delivery', 'Hi {name}, your order #{order} from {shop} is out for delivery. {when}'),
  ('sms_delivered', 'Hi {name}, your order #{order} from {shop} has been delivered. Thank you!'),
  ('sms_cancelled', 'Hi {name}, your order #{order} from {shop} has been cancelled. Call us with any questions.')
on conflict (key) do nothing;

-- Starter catalog, only when the products table is empty.
insert into products (name, unit, price)
select v.name, v.unit, v.price from (values
  ('Salmon fillet', 'kg', 17.99),
  ('Whole salmon', 'kg', 12.99),
  ('Cod fillet', 'kg', 16.99),
  ('Haddock fillet', 'kg', 15.99),
  ('Plaice fillet', 'kg', 14.99),
  ('Sea bass', 'kg', 18.99),
  ('Whole carp', 'kg', 8.99),
  ('Ground fish mix (gefilte)', 'kg', 9.99),
  ('Gefilte fish loaf', 'each', 6.99),
  ('Herring (pickled)', 'each', 4.99),
  ('Whole trout', 'kg', 11.99),
  ('Tuna steak', 'kg', 24.99)
) as v(name, unit, price)
where not exists (select 1 from products);
