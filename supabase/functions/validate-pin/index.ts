
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { employeeId, pin } = await req.json()

    // Enforce the use of a service role key for security
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Query for an active employee with matching ID and PIN
    const { data: employee, error } = await supabaseClient
      .from('employees')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('pin', pin)
      .eq('active', true)
      .single()

    if (error) {
      console.error('Supabase query error:', error.message)
      // Don't expose detailed database errors to the client
      return new Response(JSON.stringify({ valid: false, error: 'Server error during validation.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }
    
    if (employee) {
      return new Response(JSON.stringify({ valid: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    } else {
      return new Response(JSON.stringify({ valid: false, error: 'Invalid Employee ID or PIN.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401, // Unauthorized
      })
    }
  } catch (err) {
    console.error('Validation function error:', err.message)
    return new Response(JSON.stringify({ error: 'An unexpected error occurred.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
