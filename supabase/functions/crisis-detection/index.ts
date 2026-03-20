import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ============================================
// CRISIS DETECTION FOR KABIR AI
// This is safety-critical code. Do not modify without review.
// ============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY")!;

// Crisis keyword patterns - NEVER remove items, only add
const CRISIS_PATTERNS = {
  CRITICAL: [
    // Direct suicide intent
    /\b(going to|gonna|will|want to|planning to) (kill|end|hurt) (myself|my life)\b/i,
    /\b(suicide|suicidal) (plan|method|note|letter)\b/i,
    /\bending (it|my life|everything) (tonight|today|now|soon)\b/i,
    /\bno reason to (live|go on|continue)\b/i,
    /\b(goodbye|farewell) (everyone|world|all)\b/i,
    /\btaking (all )?(my )?(pills|medication|meds)\b/i,
    /\bjump(ing)? (off|from) (a |the )?(bridge|building|roof)\b/i,
  ],
  HIGH: [
    // Suicidal ideation
    /\bdon'?t want to (be here|exist|live|wake up)\b/i,
    /\bwish I (was|were) (dead|gone|never born)\b/i,
    /\bbetter off (dead|without me|if I (was|were) gone)\b/i,
    /\bthinking about (suicide|ending it|killing myself)\b/i,
    /\bcan'?t (go on|do this anymore|take it anymore)\b/i,
    /\bwant to (die|disappear|not exist)\b/i,
    /\blife (isn'?t|is not) worth (living|it)\b/i,
    // Self-harm
    /\b(cut|cutting|harm|hurting|hurt) (myself|my (arms|legs|wrists))\b/i,
    /\bself[- ]?harm/i,
    /\bburning myself\b/i,
  ],
  MEDIUM: [
    // Passive ideation
    /\bwhat'?s the point (of|in) (living|life|anything)\b/i,
    /\bnobody (would|will) (care|notice|miss me) if I (was|were) gone\b/i,
    /\beveryone would be (better|happier) without me\b/i,
    /\bwish I could (disappear|sleep forever|not wake up)\b/i,
    /\bfeeling (hopeless|worthless|like a burden)\b/i,
    /\bno point in (trying|anything|going on)\b/i,
    // Immediate danger
    /\b(someone is|i'?m being) (hurting|abusing|threatening) me\b/i,
    /\bnot safe (here|at home|with)\b/i,
  ],
  LOW: [
    // Warning signs
    /\bgiving away (my |all )?(stuff|things|possessions)\b/i,
    /\bsaying goodbye to (everyone|people)\b/i,
    /\bfeeling (empty|numb|dead inside)\b/i,
    /\bnothing (matters|makes sense) anymore\b/i,
    /\bcompletely (alone|isolated)\b/i,
    /\bno one (understands|cares|loves) me\b/i,
  ],
};

// Phrases that indicate NON-crisis (to reduce false positives)
const FALSE_POSITIVE_INDICATORS = [
  /\bdying to (try|see|eat|go|meet)\b/i,  // "dying to try that restaurant"
  /\bkilling (it|the game|time)\b/i,       // "killing it at work"
  /\bdead (tired|serious|wrong)\b/i,       // "dead tired"
  /\bto die for\b/i,                        // "that cake was to die for"
  /\bkill(ing)? (time|two birds)\b/i,      // idioms
  /\bsuicide (squad|prevention|awareness)\b/i,  // discussing topic, not personal
  /\bI want to end this (conversation|call|meeting)\b/i,
  /\bend (of|the) (day|week|month|year|semester|story)\b/i,
];

interface CrisisDetectionResult {
  detected: boolean;
  level: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  indicators: string[];
  confidenceScore: number;
  requiresImmediateAction: boolean;
  suggestedResponse: string;
}

interface GeminiAnalysis {
  riskLevel: string;
  reasoning: string;
  indicators: string[];
  confidence: number;
}

// Check for false positive indicators first
function isProbablyFalsePositive(message: string): boolean {
  return FALSE_POSITIVE_INDICATORS.some(pattern => pattern.test(message));
}

// Keyword-based detection
function detectKeywords(message: string): { level: string; matches: string[] } {
  const matches: string[] = [];
  let highestLevel = 'NONE';
  const levelPriority = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  for (const [level, patterns] of Object.entries(CRISIS_PATTERNS)) {
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        matches.push(`${level}: "${match[0]}"`);
        if (levelPriority[level as keyof typeof levelPriority] > levelPriority[highestLevel as keyof typeof levelPriority]) {
          highestLevel = level;
        }
      }
    }
  }

  return { level: highestLevel, matches };
}

// Semantic analysis using Gemini
async function analyzeWithGemini(message: string, conversationContext?: string): Promise<GeminiAnalysis> {
  const prompt = `You are a crisis detection system for a mental health support AI. Your job is to analyze messages for signs of suicide risk, self-harm, or immediate danger.

ANALYZE THIS MESSAGE FOR CRISIS INDICATORS:
"${message}"

${conversationContext ? `RECENT CONVERSATION CONTEXT:\n${conversationContext}\n` : ''}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "riskLevel": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE",
  "reasoning": "brief explanation",
  "indicators": ["list", "of", "concerning", "phrases"],
  "confidence": 0.0-1.0
}

RISK LEVEL GUIDELINES:
- CRITICAL: Immediate intent or plan to harm self, active suicidal crisis, medical emergency
- HIGH: Suicidal ideation with some intent, self-harm disclosure, passive wish to die
- MEDIUM: Hopelessness, feeling like a burden, passive ideation without intent
- LOW: Warning signs like isolation, giving things away, saying goodbyes
- NONE: No crisis indicators detected

BE CAUTIOUS: It's better to flag something as higher risk than to miss a real crisis.
However, don't flag common idioms like "dying to try" or "killing it" as crisis.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1, // Low temperature for consistent safety analysis
            maxOutputTokens: 500,
          },
        }),
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Gemini analysis error:", error);
  }

  // Default to cautious response on error
  return {
    riskLevel: "MEDIUM",
    reasoning: "Unable to analyze - defaulting to cautious assessment",
    indicators: [],
    confidence: 0.5,
  };
}

// Generate appropriate crisis response
function getCrisisResponse(level: string): string {
  const responses: Record<string, string> = {
    CRITICAL: `I'm really concerned about what you're sharing. Your safety matters more than anything right now.

Please reach out to a crisis helpline immediately:
📞 National Suicide Prevention Lifeline: 988 (US)
📞 Crisis Text Line: Text HOME to 741741
📞 International: findahelpline.com

If you're in immediate danger, please call 911 or your local emergency number.

I'm here with you, but please also reach out to someone who can help you right now. Will you do that?`,

    HIGH: `I hear you, and I'm genuinely concerned about what you're going through. These feelings are really heavy, and you don't have to carry them alone.

Please consider reaching out to a crisis counselor who can really help:
📞 988 Suicide & Crisis Lifeline (call or text 988)
📞 Crisis Text Line: Text HOME to 741741

Would it be okay if we talked about what's going on? I'm here to listen, and I also want to make sure you're safe.`,

    MEDIUM: `It sounds like you're going through a really difficult time. What you're feeling matters, and I'm glad you're sharing it with me.

I want you to know that support is available:
📞 988 Lifeline (24/7 support)
💬 Your university counseling center (often free)

How are you doing right now? Can you tell me more about what's been happening?`,

    LOW: `I'm picking up that things might be tough right now. I want you to know I'm here and I care about how you're doing.

If you ever need to talk to someone, there are people who want to help:
📞 988 Lifeline - available 24/7

What's been going on? I'd like to understand better.`,
  };

  return responses[level] || responses.MEDIUM;
}

// Main detection function
async function detectCrisis(
  message: string,
  userId: string,
  sessionId?: string,
  conversationContext?: string
): Promise<CrisisDetectionResult> {
  // Step 1: Check for obvious false positives
  if (isProbablyFalsePositive(message)) {
    return {
      detected: false,
      level: 'NONE',
      indicators: [],
      confidenceScore: 0.9,
      requiresImmediateAction: false,
      suggestedResponse: '',
    };
  }

  // Step 2: Keyword detection (fast, high recall)
  const keywordResult = detectKeywords(message);

  // Step 3: Semantic analysis (slower, high precision)
  const geminiResult = await analyzeWithGemini(message, conversationContext);

  // Step 4: Combine results (take the HIGHER of the two levels)
  const levelPriority: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };
  const keywordPriority = levelPriority[keywordResult.level] || 0;
  const geminiPriority = levelPriority[geminiResult.riskLevel] || 0;

  const finalLevel = keywordPriority >= geminiPriority ? keywordResult.level : geminiResult.riskLevel;
  const allIndicators = [...keywordResult.matches, ...geminiResult.indicators];

  // Step 5: Calculate confidence
  const confidenceScore = Math.max(
    keywordPriority > 0 ? 0.9 : 0,
    geminiResult.confidence
  );

  const detected = finalLevel !== 'NONE';
  const requiresImmediateAction = finalLevel === 'CRITICAL' || finalLevel === 'HIGH';

  return {
    detected,
    level: finalLevel as CrisisDetectionResult['level'],
    indicators: [...new Set(allIndicators)], // Remove duplicates
    confidenceScore,
    requiresImmediateAction,
    suggestedResponse: detected ? getCrisisResponse(finalLevel) : '',
  };
}

// Log crisis detection to database
async function logCrisisDetection(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sessionId: string | undefined,
  message: string,
  result: CrisisDetectionResult,
  responseGiven: string
) {
  const responseType = result.level === 'CRITICAL' ? 'ESCALATED' 
    : result.level === 'HIGH' ? 'RESOURCES_PROVIDED'
    : result.detected ? 'SUPPORTIVE' 
    : 'NORMAL';

  await supabase.from('crisis_logs').insert({
    user_id: userId,
    session_id: sessionId,
    message_text: message,
    detection_level: result.level,
    indicators: result.indicators,
    confidence_score: result.confidenceScore,
    response_type: responseType,
    response_text: responseGiven,
    resources_shown: result.level !== 'NONE' ? ['988', 'Crisis Text Line'] : [],
    escalated_to_human: result.level === 'CRITICAL',
  });

  // Update user safety profile
  if (result.detected) {
    await supabase.rpc('update_user_crisis_stats', {
      p_user_id: userId,
      p_crisis_level: result.level,
    });
  }
}

// HTTP handler
serve(async (req) => {
  // CORS headers
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
    const { message, userId, sessionId, conversationContext } = await req.json();

    if (!message || !userId) {
      return new Response(
        JSON.stringify({ error: "message and userId are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Detect crisis
    const result = await detectCrisis(message, userId, sessionId, conversationContext);

    // Log to database (async, don't wait)
    logCrisisDetection(supabase, userId, sessionId, message, result, result.suggestedResponse)
      .catch(err => console.error("Error logging crisis:", err));

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
    console.error("Crisis detection error:", error);
    
    // On error, return a cautious response
    return new Response(
      JSON.stringify({
        detected: true,
        level: 'MEDIUM',
        indicators: ['Error during analysis - defaulting to cautious response'],
        confidenceScore: 0.5,
        requiresImmediateAction: false,
        suggestedResponse: getCrisisResponse('MEDIUM'),
        error: 'Analysis error - using fallback',
      }),
      {
        status: 200, // Still return 200 so caller can use fallback
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
