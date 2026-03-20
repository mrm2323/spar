import { useState, useEffect, useCallback, useRef } from 'react';
import memory from '../services/memory';

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

  // Load initial profile
  useEffect(() => {
    if (!userId) return;

    async function loadProfile() {
      setIsLoading(true);
      try {
        const userProfile = await memory.getProfile(userId);
        setProfile(userProfile);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, [userId]);

  // Get context for current query
  const getContext = useCallback(async (query) => {
    if (!userId) return null;

    try {
      const contextProfile = await memory.getProfile(userId, query);
      return memory.formatMemoriesForPrompt(contextProfile);
    } catch (err) {
      console.error('Get context error:', err);
      return '';
    }
  }, [userId]);

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
      await memory.extractAndRemember(userId, conversationBuffer.current);
      conversationBuffer.current = [];
      
      // Refresh profile
      const updatedProfile = await memory.getProfile(userId);
      setProfile(updatedProfile);
    } catch (err) {
      console.error('Extract facts error:', err);
    }
  }, [userId]);

  // Manually remember something
  const rememberFact = useCallback(async (content, category, metadata) => {
    if (!userId) return false;

    try {
      await memory.remember(userId, content, category, metadata);
      
      // Refresh profile
      const updatedProfile = await memory.getProfile(userId);
      setProfile(updatedProfile);
      
      return true;
    } catch (err) {
      console.error('Remember fact error:', err);
      return false;
    }
  }, [userId]);

  // Search memories
  const searchMemories = useCallback(async (query, limit = 5) => {
    if (!userId) return [];
    
    try {
      return await memory.recall(userId, query, { limit });
    } catch (err) {
      console.error('Search memories error:', err);
      return [];
    }
  }, [userId]);

  // Clear all memories
  const clearAllMemories = useCallback(async () => {
    if (!userId) return false;

    try {
      await memory.forgetAll(userId);
      setProfile(null);
      return true;
    } catch (err) {
      console.error('Clear memories error:', err);
      return false;
    }
  }, [userId]);

  // Force extraction (on conversation end)
  const flushBuffer = useCallback(async () => {
    await extractFacts();
  }, [extractFacts]);

  return {
    profile,
    isLoading,
    error,
    hasMemories: memory.hasPersonalization(profile || {}),
    getContext,
    recordMessage,
    rememberFact,
    searchMemories,
    clearAllMemories,
    flushBuffer,
  };
}

export default useKabirMemory;
