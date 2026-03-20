ALTER TABLE public.time_entries
ADD COLUMN location JSONB NULL,
ADD COLUMN location_out JSONB NULL;