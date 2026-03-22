import Supermemory from "supermemory";
import {
  addUserMemory,
  getMemoryContext,
  searchMemory,
  userContainerTag,
} from "@/lib/kabir/memory";

// ============================================
// KABIR MEMORY SERVICE (Supermemory v3)
// ============================================

const SERVER_SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;
const SERVER_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supermemory = SERVER_SUPERMEMORY_API_KEY
  ? new Supermemory({ apiKey: SERVER_SUPERMEMORY_API_KEY })
  : null;

export const MEMORY_CATEGORIES = {
  IDENTITY: "identity",
  ACADEMIC: "academic",
  CAREER: "career",
  RELATIONSHIPS: "relationships",
  HEALTH: "health",
  GOALS: "goals",
  PREFERENCES: "preferences",
  EVENTS: "events",
  STRUGGLES: "struggles",
};

/**
 * Store a memory about the user (REST v3 via kabir/memory)
 */
export async function remember(userId, content, category, metadata = {}) {
  await addUserMemory(userId, content, {
    category: category || "general",
    importance: metadata.importance || 3,
    emotion: metadata.emotion || "neutral",
    ...metadata,
  });
  return { ok: true };
}

/**
 * Search for relevant memories
 */
export async function recall(userId, query, options = {}) {
  const limit = options.limit || 5;
  const lines = await searchMemory(userId, query || "");
  return lines.slice(0, limit).map((content, i) => ({ id: String(i), content }));
}

/**
 * Profile for prompts — uses full context search + optional query refinement
 */
export async function getProfile(userId, currentContext = "") {
  if (!SERVER_SUPERMEMORY_API_KEY) {
    return { staticFacts: [], dynamicContext: [], relevantMemories: [] };
  }

  try {
    const base = await getMemoryContext(userId);
    if (currentContext?.trim()) {
      const hits = await searchMemory(userId, currentContext.trim());
      return {
        staticFacts: base ? [base] : [],
        dynamicContext: [],
        relevantMemories: hits.map((content, i) => ({
          id: String(i),
          content,
        })),
      };
    }
    return {
      staticFacts: base ? [base] : [],
      dynamicContext: [],
      relevantMemories: [],
    };
  } catch (error) {
    console.error("Memory profile error:", error);
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
  if (!SERVER_OPENAI_API_KEY || !SERVER_SUPERMEMORY_API_KEY) return [];

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

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
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: "Extract user facts and return only JSON array.",
          },
          { role: "user", content: extractionPrompt },
        ],
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "[]";

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const facts = JSON.parse(jsonMatch[0]);

    for (const fact of facts) {
      await remember(userId, fact.content, fact.category, {
        importance: fact.importance,
        emotion: fact.emotion,
      });
    }

    return facts;
  } catch (error) {
    console.error("Fact extraction error:", error);
    return [];
  }
}

export async function forget(userId, memoryId) {
  if (!supermemory) return false;
  try {
    await supermemory.delete({
      containerTag: userContainerTag(userId),
      id: memoryId,
    });
    return true;
  } catch (error) {
    console.error("Memory delete error:", error);
    return false;
  }
}

export async function forgetAll(userId) {
  if (!supermemory) return false;
  try {
    await supermemory.deleteContainer({
      containerTag: userContainerTag(userId),
    });
    return true;
  } catch (error) {
    console.error("Memory clear error:", error);
    return false;
  }
}

export function formatMemoriesForPrompt(profile) {
  const sections = [];

  if (profile.staticFacts?.length > 0) {
    sections.push(
      `## What I Know About You:\n${profile.staticFacts.map((f) => `- ${f}`).join("\n")}`
    );
  }

  if (profile.dynamicContext?.length > 0) {
    sections.push(
      `## Recent Context:\n${profile.dynamicContext.map((f) => `- ${f}`).join("\n")}`
    );
  }

  if (profile.relevantMemories?.length > 0) {
    sections.push(
      `## Relevant Memories:\n${profile.relevantMemories.map((m) => `- ${m.content}`).join("\n")}`
    );
  }

  return sections.join("\n\n") || "Getting to know you...";
}

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
