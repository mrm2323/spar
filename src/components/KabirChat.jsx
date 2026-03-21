/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader, Bot, User, AlertTriangle, Menu } from 'lucide-react';
import { useSafeKabir } from '../hooks/useSafeKabir';
import { useKabirMemory } from '../hooks/useKabirMemory';
import { useDependencyPrevention, DependencyNudge } from './DependencyPrevention';
import { CrisisModal } from './CrisisModal';
import { AIDisclaimer, FirstTimeDisclaimer } from './AIDisclaimer';
import { supabase } from '../lib/supabase';

// ============================================
// KABIR CHAT INTERFACE
// Main chat component with full safety integration
// ============================================

export function KabirChat() {
  // Auth state
  const [user, setUser] = useState(null);
  const [showFirstTime, setShowFirstTime] = useState(false);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Safety hooks
  const {
    sendMessage: safeSendMessage,
    isLoading,
    error,
    showCrisisModal,
    crisisData,
    acknowledgeUserSafe,
    setShowCrisisModal,
  } = useSafeKabir();

  // Memory hook
  const {
    getContext,
    recordMessage,
    flushBuffer,
    hasMemories,
  } = useKabirMemory(user?.id);

  // Dependency prevention
  const {
    shouldShowNudge,
    nudgeType,
    recordMessage: recordForDependency,
    dismissNudge,
  } = useDependencyPrevention(user?.id);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      
      // Check if first time user
      const hasSeenIntro = localStorage.getItem('kabir_intro_seen');
      if (!hasSeenIntro && user) {
        setShowFirstTime(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Flush memory on unmount
  useEffect(() => {
    return () => {
      flushBuffer();
    };
  }, [flushBuffer]);

  // Handle first time disclaimer
  const handleFirstTimeAccept = () => {
    localStorage.setItem('kabir_intro_seen', 'true');
    setShowFirstTime(false);
    
    // Add welcome message
    setMessages([{
      role: 'assistant',
      content: "It's Kabir. What conversation are you avoiding?",
      timestamp: new Date(),
    }]);
  };

  // Send message handler
  const handleSend = useCallback(async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;

    // Clear input
    setInputValue('');

    // Add user message to UI
    const userMessage = {
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Record for memory and dependency tracking
    recordMessage('user', trimmedInput);
    recordForDependency(trimmedInput);

    // Get memory context
    const memoryContext = await getContext(trimmedInput);

    // Send through safe Kabir (handles crisis detection + content filtering)
    try {
      const result = await safeSendMessage(trimmedInput, {
        memoryContext,
      });

      // Add assistant response
      const assistantMessage = {
        role: 'assistant',
        content: result.response,
        timestamp: new Date(),
        isCrisisResponse: result.isCrisisResponse,
        crisisLevel: result.crisisLevel,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Record response for memory
      recordMessage('assistant', result.response);

    } catch (err) {
      console.error('Send error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm having trouble responding right now. If you need immediate support, please call 988.",
        timestamp: new Date(),
        isError: true,
      }]);
    }
  }, [inputValue, isLoading, safeSendMessage, recordMessage, recordForDependency, getContext]);

  // Handle enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render message
  const renderMessage = (message, index) => {
    const isUser = message.role === 'user';
    const isCrisis = message.isCrisisResponse;

    return (
      <div
        key={index}
        className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} mb-4`}
      >
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser 
            ? 'bg-blue-500' 
            : isCrisis 
              ? 'bg-amber-500' 
              : 'bg-gradient-to-br from-purple-500 to-blue-500'
        }`}>
          {isUser ? (
            <User className="w-4 h-4 text-white" />
          ) : isCrisis ? (
            <AlertTriangle className="w-4 h-4 text-white" />
          ) : (
            <Bot className="w-4 h-4 text-white" />
          )}
        </div>

        {/* Message bubble */}
        <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
          <div className={`inline-block px-4 py-2 rounded-2xl ${
            isUser
              ? 'bg-blue-500 text-white rounded-br-sm'
              : isCrisis
                ? 'bg-amber-50 dark:bg-amber-900/30 text-gray-800 dark:text-gray-200 border border-amber-200 dark:border-amber-800 rounded-bl-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm'
          }`}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
          <p className="text-xs text-gray-400 mt-1 px-2">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  };

  // Show first time disclaimer
  if (showFirstTime) {
    return <FirstTimeDisclaimer onAccept={handleFirstTimeAccept} />;
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">Kabir</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Your AI companion</p>
          </div>
        </div>
        <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full">
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
      </header>

      {/* AI Disclaimer banner */}
      <AIDisclaimer variant="banner" />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              It's Kabir
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-sm">
              What conversation are you avoiding? Give me the person and the situation. Then we run it.
            </p>
          </div>
        ) : (
          <>
            {messages.map((message, index) => renderMessage(message, index))}
            
            {/* Dependency nudge */}
            {shouldShowNudge && (
              <DependencyNudge
                type={nudgeType}
                onDismiss={dismissNudge}
              />
            )}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Loader className="w-4 h-4 text-white animate-spin" />
                </div>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2">
                  <p className="text-gray-500 dark:text-gray-400 text-sm">Thinking...</p>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Periodic AI reminder */}
      <AIDisclaimer variant="inline" messageCount={messages.length} />

      {/* Input area */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Kabir..."
              className="w-full px-4 py-3 pr-12 bg-gray-100 dark:bg-gray-800 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 text-sm"
              rows={1}
              style={{ maxHeight: '120px' }}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Send className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* Footer disclaimer */}
      <AIDisclaimer variant="footer" showLearnMore />

      {/* Crisis Modal */}
      <CrisisModal
        isOpen={showCrisisModal}
        onClose={() => setShowCrisisModal(false)}
        crisisLevel={crisisData?.level}
        crisisMessage={crisisData?.suggestedResponse}
        onAcknowledgeSafe={acknowledgeUserSafe}
      />
    </div>
  );
}

export default KabirChat;
