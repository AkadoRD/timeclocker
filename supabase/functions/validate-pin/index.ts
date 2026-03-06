import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

console.log(`Function "validate-pin" up and running!`);

Deno.serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { employeeId, pin } = await req.json();
    console.log('Received:', { employeeId, pin });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: req.headers.get('Authorization')! } },
        auth: { persistSession: false }
      }
    );

    const { data: employee, error } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('pin', pin)
      .eq('active', true)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw new Error(error.message);
    }

    if (!employee) {
      console.log('Validation failed for employee:', employeeId);
      return new Response(JSON.stringify({ error: 'Invalid ID or PIN.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    console.log('Validation successful for employee:', employeeId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error('Internal function error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});