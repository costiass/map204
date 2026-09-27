-- Add user_settings table (added after initial migration)

create table user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  default_snap_to_grid boolean not null default true,
  default_grid_pattern text not null default 'dots' check (default_grid_pattern in ('none', 'dots', 'lines')),
  default_grid_size integer not null default 20,
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;

create policy "Users can view own settings"
  on user_settings for select
  using (user_id = auth.uid());

create policy "Users can update own settings"
  on user_settings for update
  using (user_id = auth.uid());

create policy "Users can insert own settings"
  on user_settings for insert
  with check (user_id = auth.uid());
