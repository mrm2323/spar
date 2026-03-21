import Supermemory from 'supermemory';

// ============================================
// KABIR MEMORY SERVICE
// Persistent memory using Supermemory API
// ============================================

const SERVER_SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;
const SERVER_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supermemory = SERVER_SUPERMEMORY_API_KEY
  ? new Supermemory({ apiKey: SERVER_SUPERMEMORY_API_KEY })
  : null;

// Memory categories
const MEMORY_CATEGORIES = {
  IDENTITY: 'identity',         // Name, age, location, background
  ACADEMIC: 'academic',         // School, major, grades, goals
  CAREER: 'career',             // Jobs, interviews, aspirations
  RELATIONSHIPS: 'relationships', // Friends, family, romantic
  HEALTH: 'health',             // Physical, mental, habits
  GOALS: 'goals',               // Short-term, long-term
  PREFERENCES: 'preferences',   // Likes, dislikes, communication style
  EVENTS: 'events',             // Important dates, milestones
  STRUGGLES: 'struggles',       // Challenges, fears, anxieties
};

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Store a memory about the user
 */
export async function remember(userId, content, category, metadata = {}) {
  if (!supermemory) return null;
  try {
    const result = await supermemory.add({
      content,
      containerTag: `kabir_user_${userId}`,
      metadata: {
        category: category || 'general',
        importance: metadata.importance || 3, // 1-5 scale
        emotion: metadata.emotion || 'neutral',
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    });
    return result;
  } catch (error) {
    console.error('Memory store error:', error);
    return null;
  }
}

/**
 * Search for relevant memories
 */
export async function recall(userId, query, options = {}) {
  if (!supermemory) return [];
  try {
    const result = await supermemory.search({
      containerTag: `kabir_user_${userId}`,
      q: query,
      topK: options.limit || 5,
    });
    return result.results || [];
  } catch (error) {
    console.error('Memory recall error:', error);
    return [];
  }
}

/**
 * Get user's memory profile (static + dynamic facts)
 */
export async function getProfile(userId, currentContext = '') {
  if (!supermemory) {
    return { staticFacts: [], dynamicContext: [], relevantMemories: [] };
  }
  try {
    const result = await supermemory.profile({
      containerTag: `kabir_user_${userId}`,
      q: currentContext,
      includeProfile: true,
    });
    
    return {
      staticFacts: result.profile?.static || [],
      dynamicContext: result.profile?.dynamic || [],
      relevantMemories: result.searchResults || [],
    };
  } catch (error) {
    console.error('Memory profile error:', error);
    return {
      staticFacts: [],
      dynamicContext: [],
      relevantMemories: [],
    };
  }
}

/**
 * Extract and store facts from a conversation
 */
export async function extractAndRemember(userId, messages) {
  if (!SERVER_OPENAI_API_KEY || !supermemory) return [];
  // Use OpenAI to extract facts
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `
Analyze this conversation and extract important facts about the USER that Kabir (the AI) should remember.

CONVERSATION:
${conversationText}

Return ONLY a JSON array of facts to remember. Each fact should have:
- content: the fact (written in third person, e.g., "User is studying computer science")
- category: one of [identity, academic, career, relationships, health, goals, preferences, events, struggles]
- importance: 1-5 (5 being most important)
- emotion: detected emotion associated with this topic

ONLY extract facts the USER directly stated or clearly implied about THEMSELVES.
Do NOT include:
- Things the AI said
- General conversation topics
- Temporary states (unless emotionally significant)

Example output:
[
  {"content": "User is preparing for a Google interview next week", "category": "career", "importance": 5, "emotion": "anxious"},
  {"content": "User's name is Alex", "category": "identity", "importance": 4, "emotion": "neutral"}
]

Return empty array [] if no facts to extract.
`;

  try {
    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVER_OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 1000,
          messages: [
            { role: 'system', content: 'Extract user facts and return only JSON array.' },
            { role: 'user', content: extractionPrompt },
          ],
        }),
      }
    );

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    
    // Parse JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    
    const facts = JSON.parse(jsonMatch[0]);

    // Store each fact
    for (const fact of facts) {
      await remember(userId, fact.content, fact.category, {
        importance: fact.importance,
        emotion: fact.emotion,
      });
    }

    return facts;
  } catch (error) {
    console.error('Fact extraction error:', error);
    return [];
  }
}

/**
 * Delete a specific memory
 */
export async function forget(userId, memoryId) {
  if (!supermemory) return false;
  try {
    await supermemory.delete({
      containerTag: `kabir_user_${userId}`,
      id: memoryId,
    });
    return true;
  } catch (error) {
    console.error('Memory delete error:', error);
    return false;
  }
}

/**
 * Clear all memories for a user
 */
export async function forgetAll(userId) {
  if (!supermemory) return false;
  try {
    await supermemory.deleteContainer({
      containerTag: `kabir_user_${userId}`,
    });
    return true;
  } catch (error) {
    console.error('Memory clear error:', error);
    return false;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format memories for use in prompts
 */
export function formatMemoriesForPrompt(profile) {
  const sections = [];

  if (profile.staticFacts?.length > 0) {
    sections.push(`## What I Know About You:\n${profile.staticFacts.map(f => `- ${f}`).join('\n')}`);
  }

  if (profile.dynamicContext?.length > 0) {
    sections.push(`## Recent Context:\n${profile.dynamicContext.map(f => `- ${f}`).join('\n')}`);
  }

  if (profile.relevantMemories?.length > 0) {
    sections.push(`## Relevant Memories:\n${profile.relevantMemories.map(m => `- ${m.content}`).join('\n')}`);
  }

  return sections.join('\n\n') || 'Getting to know you...';
}

/**
 * Check if we have enough context to personalize
 */
export function hasPersonalization(profile) {
  return (
    (profile.staticFacts?.length > 0) ||
    (profile.dynamicContext?.length > 0) ||
    (profile.relevantMemories?.length > 0)
  );
}

const memoryService = {
  remember,
  recall,
  getProfile,
  extractAndRemember,
  forget,
  forgetAll,
  formatMemoriesForPrompt,
  hasPersonalization,
  MEMORY_CATEGORIES,
};

export default memoryService;
