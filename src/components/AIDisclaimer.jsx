/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect } from 'react';
import { Bot, Info, X, ExternalLink } from 'lucide-react';

// ============================================
// AI TRANSPARENCY DISCLAIMER
// Required by NY AI Companion Law & CA Companion Chatbot Law
// ============================================

// Show reminder after this many messages
const REMINDER_INTERVAL = 15;

// Store last reminder time in localStorage
const REMINDER_KEY = 'kabir_last_ai_reminder';

export function AIDisclaimer({ 
  variant = 'banner', // 'banner' | 'inline' | 'modal' | 'footer'
  messageCount = 0,
  onDismiss,
  showLearnMore = false,
}) {
  const [isVisible, setIsVisible] = useState(variant === 'banner' || variant === 'footer');
  const [showReminderModal, setShowReminderModal] = useState(false);

  // Check if we need to show periodic reminder
  useEffect(() => {
    if (variant !== 'banner' && messageCount > 0 && messageCount % REMINDER_INTERVAL === 0) {
      const lastReminder = localStorage.getItem(REMINDER_KEY);
      const now = Date.now();
      
      // Don't show if reminded in last hour
      if (!lastReminder || (now - parseInt(lastReminder)) > 60 * 60 * 1000) {
        setTimeout(() => setShowReminderModal(true), 0);
        localStorage.setItem(REMINDER_KEY, now.toString());
      }
    }
  }, [messageCount, variant]);

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismiss) onDismiss();
  };

  // Banner variant - shows at top of chat
  if (variant === 'banner' && isVisible) {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-800 px-4 py-2">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
            <Bot className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Kabir is an AI companion</strong> — I can offer support and conversation, but I'm not a substitute for professional mental health care.
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </button>
        </div>
      </div>
    );
  }

  // Footer variant - always visible at bottom
  if (variant === 'footer') {
    return (
      <div className="px-4 py-2 text-center border-t border-gray-100 dark:border-gray-800">
        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
          <Bot className="w-3 h-3" />
          Kabir is an AI. For mental health emergencies, call 988.
          {showLearnMore && (
            <a 
              href="/about-kabir" 
              className="text-blue-500 hover:underline ml-1"
            >
              Learn more
            </a>
          )}
        </p>
      </div>
    );
  }

  // Inline variant - subtle reminder in chat
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 mx-4 my-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs text-gray-500 dark:text-gray-400">
        <Info className="w-3 h-3 flex-shrink-0" />
        <span>
          Remember: I'm Kabir, an AI companion. I'm here to help, but for professional support, please reach out to a counselor or therapist.
        </span>
      </div>
    );
  }

  // Periodic reminder modal
  if (showReminderModal) {
    return (
      <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full shadow-xl overflow-hidden">
          <div className="p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mx-auto mb-4">
              <Bot className="w-6 h-6 text-blue-500" />
            </div>
            
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Quick reminder
            </h3>
            
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
              I'm Kabir, an AI companion. I can listen and offer support, but I'm not a therapist or counselor. For professional mental health support, please reach out to a qualified professional.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => setShowReminderModal(false)}
                className="w-full py-2.5 px-4 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors"
              >
                Got it
              </button>
              
              <a
                href="https://findahelpline.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
              >
                Find professional support
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// First-time user onboarding disclaimer
export function FirstTimeDisclaimer({ onAccept }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        <div className="p-6 space-y-5">
          {/* Logo/Avatar */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-3xl">✨</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Hey, I'm Kabir
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Your AI companion
            </p>
          </div>

          {/* Key points */}
          <div className="space-y-3">
            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-blue-500" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">I'm an AI, not a human</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">I can listen, support, and help you think through things</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm">🤝</span>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">I encourage human connection</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">I'm here to complement, not replace, your relationships</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm">⚕️</span>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">I'm not a therapist</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">For mental health concerns, please seek professional help</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm">🆘</span>
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">In crisis? Get real help</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Call 988 or your local emergency services</p>
              </div>
            </div>
          </div>

          {/* Age verification */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              By continuing, you confirm you are <strong>18 years or older</strong> and agree to our{' '}
              <a href="/terms" className="text-blue-500 hover:underline">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="text-blue-500 hover:underline">Privacy Policy</a>.
            </p>
          </div>

          {/* Accept button */}
          <button
            onClick={onAccept}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
          >
            I understand, let's talk
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIDisclaimer;
