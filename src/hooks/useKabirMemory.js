import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================
// KABIR MEMORY HOOK
// React hook for memory management
// ============================================

export function useKabirMemory(userId) {
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Track unsaved conversation for extraction
  const conversationBuffer = useRef([]);

  const hasPersonalization = useCallback((p) => {
    return (
      (p?.staticFacts?.length > 0) ||
      (p?.dynamicContext?.length > 0) ||
      (p?.relevantMemories?.length > 0)
    );
  }, []);

  const formatMemoriesForPrompt = useCallback((p) => {
    const sections = [];

    if (p?.staticFacts?.length > 0) {
      sections.push(`## What I Know About You:\n${p.staticFacts.map(f => `- ${f}`).join('\n')}`);
    }
    if (p?.dynamicContext?.length > 0) {
      sections.push(`## Recent Context:\n${p.dynamicContext.map(f => `- ${f}`).join('\n')}`);
    }
    if (p?.relevantMemories?.length > 0) {
      sections.push(`## Relevant Memories:\n${p.relevantMemories.map(m => `- ${m.content}`).join('\n')}`);
    }

    return sections.join('\n\n') || 'Getting to know you...';
  }, []);

  const callMemoryApi = useCallback(async (payload) => {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...payload }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Memory API failed');
    }

    return res.json();
  }, [userId]);

  // Load initial profile
  useEffect(() => {
    if (!userId) return;

    async function loadProfile() {
      setIsLoading(true);
      try {
        const data = await callMemoryApi({ action: 'profile' });
        const userProfile = data.profile;
        setProfile(userProfile);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, [userId, callMemoryApi]);

  // Get context for current query
  const getContext = useCallback(async (query) => {
    if (!userId) return null;

    try {
      const data = await callMemoryApi({ action: 'profile', currentContext: query });
      return data.context || formatMemoriesForPrompt(data.profile || {});
    } catch (err) {
      console.error('Get context error:', err);
      return '';
    }
  }, [userId, callMemoryApi, formatMemoriesForPrompt]);

  // Add message to buffer (for extraction)
  const recordMessage = useCallback((role, content) => {
    conversationBuffer.current.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    // Extract facts every 5 messages
    if (conversationBuffer.current.length >= 5) {
      extractFacts();
    }
  }, []);

  // Extract and store facts from buffer
  const extractFacts = useCallback(async () => {
    if (conversationBuffer.current.length === 0) return;
    
    try {
      await callMemoryApi({ action: 'extract', messages: conversationBuffer.current });
      conversationBuffer.current = [];
      
      // Refresh profile
      const updated = await callMemoryApi({ action: 'profile' });
      const updatedProfile = updated.profile;
      setProfile(updatedProfile);
    } catch (err) {
      console.error('Extract facts error:', err);
    }
  }, [userId, callMemoryApi]);

  // Manually remember something
  const rememberFact = useCallback(async (content, category, metadata) => {
    if (!userId) return false;

    try {
      await callMemoryApi({ action: 'remember', content, category, metadata });
      
      // Refresh profile
      const updated = await callMemoryApi({ action: 'profile' });
      const updatedProfile = updated.profile;
      setProfile(updatedProfile);
      
      return true;
    } catch (err) {
      console.error('Remember fact error:', err);
      return false;
    }
  }, [userId, callMemoryApi]);

  // Search memories
  const searchMemories = useCallback(async (query, limit = 5) => {
    if (!userId) return [];
    
    try {
      const data = await callMemoryApi({ action: 'recall', query, limit });
      return data.memories || [];
    } catch (err) {
      console.error('Search memories error:', err);
      return [];
    }
  }, [userId, callMemoryApi]);

  // Clear all memories
  const clearAllMemories = useCallback(async () => {
    if (!userId) return false;

    try {
      await callMemoryApi({ action: 'forget-all' });
      setProfile(null);
      return true;
    } catch (err) {
      console.error('Clear memories error:', err);
      return false;
    }
  }, [userId, callMemoryApi]);

  // Force extraction (on conversation end)
  const flushBuffer = useCallback(async () => {
    await extractFacts();
  }, [extractFacts]);

  return {
    profile,
    isLoading,
    error,
    hasMemories: hasPersonalization(profile || {}),
    getContext,
    recordMessage,
    rememberFact,
    searchMemories,
    clearAllMemories,
    flushBuffer,
  };
}

export default useKabirMemory;
