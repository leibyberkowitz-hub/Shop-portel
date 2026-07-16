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

insert into settings (key, value) values
  ('shop_name', 'The Fish Shop'),
  ('auto_sms', '1'),
  ('sms_confirmed', 'Hi {name}, your order #{order} from {shop} is confirmed. Total: ${total}. {when}We will text you with updates.'),
  ('sms_ready', 'Hi {name}, your order #{order} from {shop} is ready for pickup! Total: ${total}.'),
  ('sms_out_for_delivery', 'Hi {name}, your order #{order} from {shop} is out for delivery. {when}'),
  ('sms_delivered', 'Hi {name}, your order #{order} from {shop} has been delivered. Thank you!'),
  ('sms_cancelled', 'Hi {name}, your order #{order} from {shop} has been cancelled. Call us with any questions.')
on conflict (key) do nothing;

-- Starter catalog, only when the products table is empty.
insert into products (name, unit, price)
select v.name, v.unit, v.price from (values
  ('Salmon fillet', 'lb', 14.99),
  ('Whole salmon', 'lb', 10.99),
  ('Tilapia fillet', 'lb', 8.99),
  ('Flounder fillet', 'lb', 12.99),
  ('Whitefish', 'lb', 9.99),
  ('Whole carp', 'lb', 6.99),
  ('Ground fish mix (gefilte)', 'lb', 7.99),
  ('Gefilte fish loaf', 'each', 11.99),
  ('Herring (pickled)', 'each', 6.49),
  ('Branzino', 'lb', 13.99),
  ('Red snapper', 'lb', 15.99),
  ('Tuna steak', 'lb', 17.99)
) as v(name, unit, price)
where not exists (select 1 from products);
