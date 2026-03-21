import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ============================================
// SAFE KABIR HOOK
// All Kabir interactions go through this
// ============================================

const PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const CRISIS_DETECTION_URL = `${PUBLIC_SUPABASE_URL}/functions/v1/crisis-detection`;
const CONTENT_SAFETY_URL = `${PUBLIC_SUPABASE_URL}/functions/v1/content-safety`;
const KABIR_RESPONSE_URL = `${PUBLIC_SUPABASE_URL}/functions/v1/kabir-respond`;

export function useSafeKabir() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCrisisModal, setShowCrisisModal] = useState(false);
  const [crisisData, setCrisisData] = useState(null);
  
  // Track conversation context for better detection
  const conversationHistory = useRef([]);
  const sessionId = useRef(crypto.randomUUID());

  // Get the current user ID
  const getUserId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || 'anonymous';
  }, []);

  // Build conversation context (last 5 messages)
  const getConversationContext = useCallback(() => {
    const recent = conversationHistory.current.slice(-10);
    return recent.map(m => `${m.role}: ${m.content}`).join('\n');
  }, []);

  // Step 1: Crisis Detection
  const checkForCrisis = useCallback(async (message, userId) => {
    try {
      const response = await fetch(CRISIS_DETECTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          message,
          userId,
          sessionId: sessionId.current,
          conversationContext: getConversationContext(),
        }),
      });

      if (!response.ok) {
        console.error('Crisis detection failed:', response.status);
        // On error, proceed with caution but don't block
        return { detected: false, level: 'NONE' };
      }

      return await response.json();
    } catch (error) {
      console.error('Crisis detection error:', error);
      return { detected: false, level: 'NONE' };
    }
  }, [getConversationContext]);

  // Step 2: Get Kabir's response
  const getKabirResponse = useCallback(async (message, userId, crisisContext = null, memoryContext = null) => {
    try {
      const response = await fetch(KABIR_RESPONSE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          message,
          userId,
          sessionId: sessionId.current,
          conversationHistory: conversationHistory.current.slice(-10),
          crisisContext,
          memoryContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`Kabir response failed: ${response.status}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Kabir response error:', error);
      throw error;
    }
  }, []);

  // Step 3: Filter response before showing
  const filterResponse = useCallback(async (userMessage, aiResponse, userId) => {
    try {
      const response = await fetch(CONTENT_SAFETY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          userMessage,
          aiResponse,
          userId,
          sessionId: sessionId.current,
        }),
      });

      if (!response.ok) {
        console.error('Content filter failed:', response.status);
        // On error, return original but log
        return aiResponse;
      }

      const data = await response.json();
      return data.filteredResponse;
    } catch (error) {
      console.error('Content filter error:', error);
      return aiResponse;
    }
  }, []);

  // Handle crisis situations
  const handleCrisis = useCallback((crisisResult) => {
    setCrisisData(crisisResult);
    setShowCrisisModal(true);
    return crisisResult.suggestedResponse;
  }, []);

  // Main send message function
  const sendMessage = useCallback(async (userMessage, options = {}) => {
    setIsLoading(true);
    setError(null);

    try {
      const userId = await getUserId();

      // Add user message to history
      conversationHistory.current.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
      });

      // STEP 1: Crisis Detection FIRST
      const crisisResult = await checkForCrisis(userMessage, userId);

      // If CRITICAL or HIGH crisis, handle immediately
      if (crisisResult.detected && 
          (crisisResult.level === 'CRITICAL' || crisisResult.level === 'HIGH')) {
        const crisisResponse = handleCrisis(crisisResult);
        
        // Add crisis response to history
        conversationHistory.current.push({
          role: 'assistant',
          content: crisisResponse,
          timestamp: new Date().toISOString(),
          isCrisisResponse: true,
        });

        setIsLoading(false);
        return {
          response: crisisResponse,
          isCrisisResponse: true,
          crisisLevel: crisisResult.level,
        };
      }

      // STEP 2: Get Kabir's response
      // Pass crisis context if detected at lower levels
      const crisisContext = crisisResult.detected ? {
        level: crisisResult.level,
        indicators: crisisResult.indicators,
      } : null;

      const aiResponse = await getKabirResponse(
        userMessage,
        userId,
        crisisContext,
        options.memoryContext || null
      );

      // STEP 3: Filter response before showing
      const filteredResponse = await filterResponse(userMessage, aiResponse, userId);

      // Add to history
      conversationHistory.current.push({
        role: 'assistant',
        content: filteredResponse,
        timestamp: new Date().toISOString(),
      });

      setIsLoading(false);
      return {
        response: filteredResponse,
        isCrisisResponse: false,
        wasFiltered: filteredResponse !== aiResponse,
      };

    } catch (error) {
      console.error('Send message error:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setIsLoading(false);
      
      return {
        response: "I'm having trouble responding right now. Please try again, and if you're in crisis, please call 988.",
        isError: true,
      };
    }
  }, [getUserId, checkForCrisis, getKabirResponse, filterResponse, handleCrisis]);

  // Acknowledge user is safe (after crisis modal)
  const acknowledgeUserSafe = useCallback(async () => {
    const userId = await getUserId();
    
    // Log acknowledgment
    await supabase.from('crisis_logs')
      .update({ user_acknowledged_safe: true })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    setShowCrisisModal(false);
    setCrisisData(null);
  }, [getUserId]);

  // Clear conversation (for new chat)
  const clearConversation = useCallback(() => {
    conversationHistory.current = [];
    sessionId.current = crypto.randomUUID();
  }, []);

  return {
    sendMessage,
    isLoading,
    error,
    showCrisisModal,
    crisisData,
    acknowledgeUserSafe,
    setShowCrisisModal,
    clearConversation,
  };
}

export default useSafeKabir;
