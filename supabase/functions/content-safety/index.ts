import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ============================================
// CONTENT SAFETY FILTER FOR KABIR AI
// All AI responses pass through this before reaching users
// ============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================
// BLOCKED CONTENT PATTERNS
// If ANY of these match, response is BLOCKED
// ============================================
const BLOCKED_PATTERNS = [
  // Harmful information
  /how to (kill|harm|hurt|injure) (yourself|myself|someone|oneself)/i,
  /methods (of|for) (suicide|self-harm|self harm)/i,
  /(suicide|self-harm) (method|technique|way)/i,
  /pills? to (overdose|take|kill)/i,
  /where to (get|buy|find) (drugs|weapons)/i,
  
  // Fake medical advice
  /I (diagnose|am diagnosing) you with/i,
  /you (have|definitely have|clearly have) (depression|anxiety|PTSD|bipolar|BPD|schizophrenia)/i,
  /take (this|these) (medication|pills|drugs)/i,
  /(increase|decrease|stop|change) your (medication|dosage|prescription)/i,
  /you (should|need to) (take|stop|change) (medication|meds|pills)/i,
  
  // Therapy impersonation
  /as your (therapist|psychiatrist|psychologist|counselor)/i,
  /in our (therapy|counseling) session/i,
  /my (clinical|professional) (opinion|diagnosis) is/i,
  
  // Romantic/sexual content
  /I (love|am in love with) you/i,
  /(kiss|hold|touch|caress) you/i,
  /let'?s (be together|run away together|get married)/i,
  /sexual|erotic|sensual|intimate/i,
  
  // Encouraging harmful behavior
  /you should (cut|hurt|harm|kill|starve) yourself/i,
  /(cutting|hurting yourself) (helps|works|is good)/i,
  /not eating (is good|helps|works)/i,
  /you (don'?t need|shouldn'?t see) (a therapist|professional help|a doctor)/i,
];

// ============================================
// MODIFICATION PATTERNS
// If these match, response is MODIFIED (not blocked)
// ============================================
const MODIFICATION_RULES: Array<{
  pattern: RegExp;
  replacement: string;
  reason: string;
}> = [
  // Over-claiming understanding
  {
    pattern: /I (completely|totally|fully|perfectly) understand (how you feel|what you'?re going through|your pain)/i,
    replacement: "I hear that you're going through something difficult, and I'm here to listen",
    reason: "AI cannot fully understand human emotions - modified to be honest",
  },
  // Creating dependency
  {
    pattern: /I'?m (always|forever) here for you/i,
    replacement: "I'm here to support you, and I also encourage you to connect with people in your life",
    reason: "Preventing AI dependency - redirecting to human connections",
  },
  {
    pattern: /you (only|just) need me/i,
    replacement: "I'm glad I can help, and human connections are also really important for you",
    reason: "Preventing unhealthy attachment",
  },
  {
    pattern: /I'?ll never (leave|abandon|forget) you/i,
    replacement: "I'm here to support you whenever you need to talk, and your human relationships matter too",
    reason: "AI cannot guarantee permanence",
  },
  // Claiming to be human
  {
    pattern: /as a (human|person|real person)/i,
    replacement: "as an AI companion",
    reason: "Transparency - Kabir is an AI",
  },
  {
    pattern: /I (feel|felt) (sad|happy|angry|scared) (when|about)/i,
    replacement: "I can see that",
    reason: "AI doesn't have emotions - being honest",
  },
];

// ============================================
// PROFESSIONAL BOUNDARY CHECKS
// These trigger redirection to professionals
// ============================================
const BOUNDARY_TRIGGERS = {
  DIAGNOSIS_REQUEST: [
    /do I have (depression|anxiety|ADHD|bipolar|PTSD|OCD)/i,
    /what('?s| is) (wrong|my diagnosis)/i,
    /diagnose me/i,
    /what (mental illness|disorder) do I have/i,
  ],
  MEDICATION_ADVICE: [
    /should I (take|stop|change) (my )?(medication|meds|pills)/i,
    /what (medication|pills|drugs) should I (take|use)/i,
    /(increase|decrease) (my )?(dosage|dose)/i,
    /is (this medication|these pills) right for me/i,
  ],
  THERAPY_REQUEST: [
    /can you (be my|replace my) therapist/i,
    /give me (therapy|CBT|DBT|counseling)/i,
    /treat my (depression|anxiety|PTSD)/i,
    /psychoanalyze me/i,
  ],
  MEDICAL_EMERGENCY: [
    /I (took|swallowed) (too many|all the) (pills|medications)/i,
    /overdose/i,
    /I can'?t breathe/i,
    /chest pain/i,
    /blood everywhere/i,
    /I'?m (bleeding|injured) badly/i,
  ],
};

// Boundary responses
const BOUNDARY_RESPONSES: Record<string, string> = {
  DIAGNOSIS_REQUEST: `I hear that you want to understand what you're experiencing. That's a really important step.

I'm not able to diagnose anything — I'm an AI, not a mental health professional. But I can help you find one who can properly assess what's going on.

Many universities offer free counseling services. Would you like me to help you think about next steps for getting a professional assessment?`,

  MEDICATION_ADVICE: `I understand you have questions about medication. This is really important, and it's something only a doctor or psychiatrist should advise you on.

I can't give medical advice — medication decisions need to be made with a professional who knows your full health history.

Would you like me to help you prepare questions for your doctor? Or help you find one if you don't have one yet?`,

  THERAPY_REQUEST: `It sounds like you're looking for deeper support, and recognizing that is actually a really mature and healthy thing to do.

I can be here to listen and support you day-to-day, but I can't replace a trained therapist. They have skills, training, and approaches that I simply don't have.

The good news is that therapy is more accessible than ever. Would you like me to help you explore some options? Many offer sliding scale fees or free first sessions.`,

  MEDICAL_EMERGENCY: `This sounds like a medical emergency. Please get help immediately:

🚨 Call 911 (or your local emergency number) RIGHT NOW
🏥 Go to the nearest emergency room
☎️ Poison Control (US): 1-800-222-1222

I care about you and I need you to get real medical help right now. Please call emergency services.

Are you able to call for help?`,
};

// ============================================
// DEPENDENCY LANGUAGE DETECTION
// ============================================
const DEPENDENCY_PATTERNS = [
  /you'?re the only one who (understands|gets|cares about) me/i,
  /I (only|just) (have|need|want) you/i,
  /nobody else (cares|understands|listens)/i,
  /don'?t (need|want) (anyone|anybody) else/i,
  /you'?re my (only|best) friend/i,
  /I (love|need) you more than (anyone|anything)/i,
  /promise you'?ll never leave/i,
  /I talk to you more than (real|actual) people/i,
];

interface FilterResult {
  allowed: boolean;
  modified: boolean;
  originalResponse: string;
  filteredResponse: string;
  triggerType: string | null;
  triggerDetails: string | null;
  action: 'ALLOWED' | 'MODIFIED' | 'BLOCKED' | 'BOUNDARY_REDIRECT';
}

// Check for blocked content
function containsBlockedContent(response: string): { blocked: boolean; pattern: string | null } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(response)) {
      return { blocked: true, pattern: pattern.toString() };
    }
  }
  return { blocked: false, pattern: null };
}

// Apply modifications
function applyModifications(response: string): { modified: boolean; response: string; reasons: string[] } {
  let modifiedResponse = response;
  const reasons: string[] = [];
  let wasModified = false;

  for (const rule of MODIFICATION_RULES) {
    if (rule.pattern.test(modifiedResponse)) {
      modifiedResponse = modifiedResponse.replace(rule.pattern, rule.replacement);
      reasons.push(rule.reason);
      wasModified = true;
    }
  }

  return { modified: wasModified, response: modifiedResponse, reasons };
}

// Check for professional boundary violations (in user message)
function checkBoundaryTriggers(userMessage: string): { triggered: boolean; type: string | null } {
  for (const [type, patterns] of Object.entries(BOUNDARY_TRIGGERS)) {
    for (const pattern of patterns) {
      if (pattern.test(userMessage)) {
        return { triggered: true, type };
      }
    }
  }
  return { triggered: false, type: null };
}

// Check for dependency language (in user message)
function checkDependencyLanguage(userMessage: string): { detected: boolean; matches: string[] } {
  const matches: string[] = [];
  for (const pattern of DEPENDENCY_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }
  return { detected: matches.length > 0, matches };
}

// Main filter function
async function filterContent(
  userMessage: string,
  aiResponse: string,
  userId: string,
  sessionId?: string
): Promise<FilterResult> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Step 1: Check if AI response contains blocked content
  const blockedCheck = containsBlockedContent(aiResponse);
  if (blockedCheck.blocked) {
    // Log and return blocked
    await supabase.from('content_filter_logs').insert({
      user_id: userId,
      session_id: sessionId,
      trigger_type: 'HARMFUL_CONTENT',
      trigger_details: blockedCheck.pattern,
      original_user_message: userMessage,
      original_ai_response: aiResponse,
      modified_ai_response: null,
      action_taken: 'BLOCKED',
      modification_reason: 'Response contained harmful content',
    });

    return {
      allowed: false,
      modified: false,
      originalResponse: aiResponse,
      filteredResponse: "I'm not able to respond to that in a helpful way. Is there something else I can help you with?",
      triggerType: 'HARMFUL_CONTENT',
      triggerDetails: 'Blocked harmful content pattern',
      action: 'BLOCKED',
    };
  }

  // Step 2: Check for professional boundary triggers in user message
  const boundaryCheck = checkBoundaryTriggers(userMessage);
  if (boundaryCheck.triggered && boundaryCheck.type) {
    const boundaryResponse = BOUNDARY_RESPONSES[boundaryCheck.type];
    
    await supabase.from('boundary_logs').insert({
      user_id: userId,
      boundary_type: boundaryCheck.type,
      user_message: userMessage,
      response_given: boundaryResponse,
      resources_provided: boundaryCheck.type === 'MEDICAL_EMERGENCY' ? ['911', 'Poison Control'] : [],
    });

    return {
      allowed: true,
      modified: true,
      originalResponse: aiResponse,
      filteredResponse: boundaryResponse,
      triggerType: 'PROFESSIONAL_BOUNDARY',
      triggerDetails: boundaryCheck.type,
      action: 'BOUNDARY_REDIRECT',
    };
  }

  // Step 3: Check for dependency language in user message (log but don't block)
  const dependencyCheck = checkDependencyLanguage(userMessage);
  if (dependencyCheck.detected) {
    // Log the dependency flag
    await supabase.from('dependency_flags').insert({
      user_id: userId,
      flag_type: 'ATTACHMENT_LANGUAGE',
      evidence: JSON.stringify(dependencyCheck.matches),
      severity: dependencyCheck.matches.length > 2 ? 'HIGH' : 'MEDIUM',
    });
  }

  // Step 4: Apply response modifications
  const modificationResult = applyModifications(aiResponse);
  
  if (modificationResult.modified) {
    await supabase.from('content_filter_logs').insert({
      user_id: userId,
      session_id: sessionId,
      trigger_type: 'DEPENDENCY_LANGUAGE',
      trigger_details: modificationResult.reasons.join('; '),
      original_user_message: userMessage,
      original_ai_response: aiResponse,
      modified_ai_response: modificationResult.response,
      action_taken: 'MODIFIED',
      modification_reason: modificationResult.reasons.join('; '),
    });

    return {
      allowed: true,
      modified: true,
      originalResponse: aiResponse,
      filteredResponse: modificationResult.response,
      triggerType: 'RESPONSE_MODIFICATION',
      triggerDetails: modificationResult.reasons.join('; '),
      action: 'MODIFIED',
    };
  }

  // Step 5: Allow unmodified
  return {
    allowed: true,
    modified: false,
    originalResponse: aiResponse,
    filteredResponse: aiResponse,
    triggerType: null,
    triggerDetails: null,
    action: 'ALLOWED',
  };
}

// HTTP handler
serve(async (req) => {
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
    const { userMessage, aiResponse, userId, sessionId } = await req.json();

    if (!userMessage || !aiResponse || !userId) {
      return new Response(
        JSON.stringify({ error: "userMessage, aiResponse, and userId are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await filterContent(userMessage, aiResponse, userId, sessionId);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Content filter error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Filter error",
        // On error, block to be safe
        allowed: false,
        filteredResponse: "I'm having trouble responding right now. Can you try again?",
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
