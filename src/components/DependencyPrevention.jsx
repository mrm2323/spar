import React, { useState, useEffect } from 'react';
import { Users, Heart, Phone, Coffee, Sun, Moon, Calendar } from 'lucide-react';

// ============================================
// DEPENDENCY PREVENTION
// Gentle nudges to maintain human connections
// ============================================

// Nudge messages by context
const NUDGE_MESSAGES = {
  high_usage: [
    {
      icon: Users,
      title: "Your humans miss you",
      message: "We've been chatting a lot today! Have you connected with a friend or family member recently?",
      cta: "Maybe text someone",
    },
    {
      icon: Coffee,
      title: "Real-world connection",
      message: "Nothing replaces a good conversation over coffee. Anyone you've been meaning to catch up with?",
      cta: "Think of someone",
    },
  ],
  late_night: [
    {
      icon: Moon,
      title: "It's late",
      message: "I'm happy to chat, but getting some rest might help too. Is there something keeping you up?",
      cta: "Let's wind down",
    },
    {
      icon: Phone,
      title: "Someone to call?",
      message: "If you're having trouble sleeping, sometimes hearing a familiar voice helps. Anyone you could call?",
      cta: "Think about it",
    },
  ],
  isolation_detected: [
    {
      icon: Heart,
      title: "You matter to people",
      message: "I've noticed you've mentioned feeling alone. Remember, there are people who care about you in real life.",
      cta: "Who cares about you?",
    },
    {
      icon: Users,
      title: "Human connection",
      message: "I can be here for you, but I also want to encourage you to reach out to people in your life. They need you too.",
      cta: "Reach out today",
    },
  ],
  general: [
    {
      icon: Sun,
      title: "Get outside",
      message: "Fresh air and sunlight can really help. Consider taking a short walk today?",
      cta: "Good idea",
    },
    {
      icon: Calendar,
      title: "Make plans",
      message: "Having something to look forward to with others can really boost your mood. Any plans coming up?",
      cta: "I'll think about it",
    },
  ],
};

// Check if it's late night
function isLateNight() {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

// Random nudge from category
function getRandomNudge(category) {
  const nudges = NUDGE_MESSAGES[category] || NUDGE_MESSAGES.general;
  return nudges[Math.floor(Math.random() * nudges.length)];
}

export function DependencyNudge({ 
  type = 'general', // 'high_usage' | 'late_night' | 'isolation_detected' | 'general'
  onDismiss,
  onAction,
}) {
  const nudge = getRandomNudge(type);
  const Icon = nudge.icon;

  return (
    <div className="mx-4 my-3 p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl border border-purple-100 dark:border-purple-800/50">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-purple-500" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm">
            {nudge.title}
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {nudge.message}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                if (onAction) onAction(nudge.cta);
                if (onDismiss) onDismiss();
              }}
              className="px-3 py-1.5 bg-purple-500 text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors"
            >
              {nudge.cta}
            </button>
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-gray-500 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to manage dependency prevention nudges
export function useDependencyPrevention(userId) {
  const [shouldShowNudge, setShouldShowNudge] = useState(false);
  const [nudgeType, setNudgeType] = useState('general');
  
  // Track messages in this session
  const [sessionMessages, setSessionMessages] = useState(0);
  
  // Last nudge time
  const NUDGE_COOLDOWN = 15 * 60 * 1000; // 15 minutes
  const [lastNudgeTime, setLastNudgeTime] = useState(0);

  // Check conditions for showing nudge
  const checkNudgeConditions = () => {
    const now = Date.now();
    
    // Don't nudge too frequently
    if (now - lastNudgeTime < NUDGE_COOLDOWN) {
      return;
    }

    // Check late night
    if (isLateNight() && sessionMessages >= 5) {
      setNudgeType('late_night');
      setShouldShowNudge(true);
      setLastNudgeTime(now);
      return;
    }

    // Check high usage
    if (sessionMessages >= 20) {
      setNudgeType('high_usage');
      setShouldShowNudge(true);
      setLastNudgeTime(now);
      return;
    }

    // General nudge after 30 messages
    if (sessionMessages >= 30 && sessionMessages % 15 === 0) {
      setNudgeType('general');
      setShouldShowNudge(true);
      setLastNudgeTime(now);
    }
  };

  // Called after each message
  const recordMessage = (messageContent) => {
    setSessionMessages(prev => prev + 1);
    
    // Check for isolation language
    const isolationPatterns = [
      /nobody (understands|cares|gets) me/i,
      /all alone/i,
      /no (one|friends)/i,
      /you'?re the only one/i,
    ];
    
    const hasIsolationLanguage = isolationPatterns.some(p => p.test(messageContent));
    if (hasIsolationLanguage) {
      setNudgeType('isolation_detected');
      setShouldShowNudge(true);
      setLastNudgeTime(Date.now());
      return;
    }

    checkNudgeConditions();
  };

  const dismissNudge = () => {
    setShouldShowNudge(false);
  };

  return {
    shouldShowNudge,
    nudgeType,
    recordMessage,
    dismissNudge,
  };
}

export default DependencyNudge;
