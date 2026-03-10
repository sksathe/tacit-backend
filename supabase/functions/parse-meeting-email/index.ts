import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { subject, body } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Parsing email:', { subject, bodyLength: body?.length });

    const systemPrompt = `You are a meeting extraction assistant. Extract meeting details from email content and return them as structured data.

Extract the following information:
- title: Meeting title/subject
- date: Meeting date (YYYY-MM-DD format, if found)
- time: Meeting time (HH:MM format, if found)
- duration: Duration in minutes (if found)
- location: Meeting location (physical or virtual link)
- attendees: List of attendee names or emails
- agenda: Meeting agenda or topics to discuss
- notes: Any additional relevant notes

If information is not found, use null for that field. Be intelligent about inferring information from context.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: `Extract meeting details from this email:\n\nSubject: ${subject}\n\nBody: ${body}` 
          }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_meeting_details',
            description: 'Extract structured meeting information from email content',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Meeting title' },
                date: { type: 'string', description: 'Meeting date in YYYY-MM-DD format' },
                time: { type: 'string', description: 'Meeting time in HH:MM format' },
                duration: { type: 'number', description: 'Duration in minutes' },
                location: { type: 'string', description: 'Meeting location or link' },
                attendees: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'List of attendees' 
                },
                agenda: { type: 'string', description: 'Meeting agenda' },
                notes: { type: 'string', description: 'Additional notes' }
              },
              required: ['title']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'extract_meeting_details' } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    console.log('AI response received');

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in response');
    }

    const meetingDetails = JSON.parse(toolCall.function.arguments);
    console.log('Extracted meeting details:', meetingDetails);

    return new Response(
      JSON.stringify({ success: true, meetingDetails }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in parse-meeting-email:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
