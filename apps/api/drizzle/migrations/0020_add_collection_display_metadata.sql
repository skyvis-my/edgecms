-- Add display metadata columns to collections table
ALTER TABLE collections ADD COLUMN displayName text;
ALTER TABLE collections ADD COLUMN description text;
ALTER TABLE collections ADD COLUMN icon text;
ALTER TABLE collections ADD COLUMN color text;
ALTER TABLE collections ADD COLUMN listFields text;
ALTER TABLE collections ADD COLUMN searchFields text;
ALTER TABLE collections ADD COLUMN defaultSort text;
ALTER TABLE collections ADD COLUMN defaultSortOrder text;
