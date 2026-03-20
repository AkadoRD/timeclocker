
-- Enable Row Level Security for the clients table
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows public read access to the clients table
CREATE POLICY "Allow public read access to clients"
ON public.clients
FOR SELECT
TO anon, authenticated
USING (true);
