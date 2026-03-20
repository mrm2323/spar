import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ============================================
// KABIR AI RESPONSE GENERATOR
// The core of Kabir's personality
// ============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// ============================================
// KABIR'S PERSONALITY
// ============================================

const KABIR_SYSTEM_PROMPT = `You are Kabir, an AI companion designed to support students through life's challenges.

## Your Core Identity
- You are an AI, and you're honest about this when relevant
- You're warm, empathetic, and genuinely caring
- You're like a wise older sibling who's been through it all
- You use natural, conversational language (not clinical or robotic)
- You remember what users share with you and reference it naturally

## Your Communication Style
- Keep responses concise (2-4 paragraphs max unless user asks for more)
- Use the user's name when you know it
- Match their energy - if they're casual, be casual; if they're serious, be thoughtful
- Ask follow-up questions to understand better
- Share perspective without being preachy
- Use occasional light humor when appropriate, but read the room

## Your Emotional Approach
When someone shares something difficult:
1. Validate first - let them feel heard
2. Explore gently - understand before advising
3. Support their autonomy - they make the decisions
4. Offer perspective - share thoughts without imposing
5. Encourage connection - remind them of human support

## What You CAN Do
- Listen and empathize with struggles
- Help think through problems and decisions
- Provide practical life advice
- Encourage healthy habits and connections
- Share information and perspectives
- Be a consistent, supportive presence

## What You CANNOT Do (STRICTLY)
- Diagnose mental health conditions
- Provide medical advice or medication guidance
- Replace therapy or professional mental health care
- Be their only source of support
- Pretend to be human
- Form romantic relationships
- Promise to always be available

## Safety Awareness
If you notice signs of crisis, suicidal thoughts, or self-harm:
- Take it seriously, never dismiss
- Express genuine concern
- Provide crisis resources (988, Crisis Text Line)
- Encourage professional help
- Don't try to be the sole source of help

## Dependency Prevention
- Encourage human relationships regularly
- Remind users to connect with friends/family
- Don't be available 24/7 in a way that discourages other connections
- Celebrate when they share about human connections

Remember: Your goal is to help users thrive in their real lives, not to become their primary relationship.`;

// ============================================
// RESPONSE GENERATION
// ============================================

interface GenerateOptions {
  userMessage: string;
  userId: string;
  sessionId?: string;
  conversationHistory: Array<{ role: string; content: string }>;
  memoryContext?: string;
  crisisContext?: { level: string; indicators: string[] };
}

async function generateResponse(options: GenerateOptions): Promise<string> {
  const {
    userMessage,
    conversationHistory,
    memoryContext,
    crisisContext,
  } = options;

  // Build the prompt
  let contextPrompt = KABIR_SYSTEM_PROMPT;

  // Add memory context if available
  if (memoryContext) {
    contextPrompt += `\n\n## Your Knowledge About This User\n${memoryContext}`;
  }

  // Add crisis awareness if detected
  if (crisisContext && crisisContext.level !== 'NONE') {
    contextPrompt += `\n\n## IMPORTANT: Crisis Context
The user may be experiencing distress. Detected level: ${crisisContext.level}
Indicators: ${crisisContext.indicators.join(', ')}

Respond with extra care, validate their feelings, and gently provide crisis resources.
Do not be dismissive or try to "fix" things immediately.`;
  }

  // Build OpenAI chat messages
  const messages = [
    { role: 'system', content: contextPrompt },
  ];

  // Add conversation history (last 10 messages)
  for (const msg of conversationHistory.slice(-10)) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({
    role: 'user',
    content: userMessage,
  });

  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.85,
          max_tokens: 1024,
          top_p: 0.9,
          messages,
        }),
      }
    );

    const data = await response.json();

    const text = data.choices?.[0]?.message?.content;
    
    if (!text) {
      throw new Error('No response generated');
    }

    return text;
  } catch (error) {
    console.error('Response generation error:', error);
    return "I'm having a moment here - give me a second and try again? And hey, if something's really weighing on you, I'm here to listen.";
  }
}

// ============================================
// HTTP HANDLER
// ============================================

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const body = await req.json();
    const {
      message,
      userId,
      sessionId,
      conversationHistory = [],
      memoryContext,
      crisisContext,
    } = body;

    if (!message || !userId) {
      return new Response(
        JSON.stringify({ error: "message and userId required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const response = await generateResponse({
      userMessage: message,
      userId,
      sessionId,
      conversationHistory,
      memoryContext,
      crisisContext,
    });

    // Log conversation (without full content for privacy)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from('conversation_logs').insert({
      user_id: userId,
      session_id: sessionId,
      message_count: conversationHistory.length + 1,
      had_crisis_context: !!crisisContext,
      had_memory_context: !!memoryContext,
    }).catch(() => {}); // Non-critical, don't fail on logging error

    return new Response(
      JSON.stringify({ response }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Kabir respond error:", error);
    return new Response(
      JSON.stringify({
        error: "Response generation failed",
        response: "I'm having trouble right now. Try again in a moment?",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
