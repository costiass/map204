-- Fix ID types: change from uuid to text to match app-generated IDs

-- Drop and recreate pages table with text IDs
alter table pages alter column id type text;
alter table pages alter column document_id type text;

-- Drop and recreate documents table with text IDs
alter table documents alter column id type text;

-- Drop and recreate document_collaborators table
alter table document_collaborators alter column document_id type text;

-- Fix user_settings table
alter table user_settings alter column user_id type text;
