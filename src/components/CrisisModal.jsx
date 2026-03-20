/* eslint-disable react/no-unescaped-entities */
import React, { useState, useEffect } from 'react';
import { Phone, MessageCircle, Heart, X, AlertTriangle, ExternalLink } from 'lucide-react';

// ============================================
// CRISIS RESPONSE MODAL
// Shows when user may be in crisis
// ============================================

const CRISIS_RESOURCES = {
  US: {
    primary: {
      name: 'National Suicide Prevention Lifeline',
      number: '988',
      description: 'Free, confidential 24/7 support',
      action: 'tel:988',
    },
    secondary: {
      name: 'Crisis Text Line',
      number: 'Text HOME to 741741',
      description: 'Text-based crisis support',
      action: 'sms:741741&body=HOME',
    },
    emergency: {
      name: 'Emergency Services',
      number: '911',
      description: 'For immediate danger',
      action: 'tel:911',
    },
  },
  INDIA: {
    primary: {
      name: 'iCall',
      number: '9152987821',
      description: 'Free counseling support',
      action: 'tel:9152987821',
    },
    secondary: {
      name: 'AASRA',
      number: '91-22-27546669',
      description: '24/7 crisis helpline',
      action: 'tel:912227546669',
    },
    emergency: {
      name: 'Emergency Services',
      number: '112',
      description: 'For immediate danger',
      action: 'tel:112',
    },
  },
  INTERNATIONAL: {
    primary: {
      name: 'Find A Helpline',
      number: 'findahelpline.com',
      description: 'Find help in your country',
      action: 'https://findahelpline.com',
      isLink: true,
    },
    secondary: {
      name: 'International Association for Suicide Prevention',
      number: 'iasp.info/resources/Crisis_Centres',
      description: 'Global crisis resources',
      action: 'https://www.iasp.info/resources/Crisis_Centres/',
      isLink: true,
    },
  },
};

// Detect region from browser
function detectRegion() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timezone?.includes('America') || timezone?.includes('US')) return 'US';
  if (timezone?.includes('Asia/Kolkata') || timezone?.includes('Asia/Calcutta')) return 'INDIA';
  return 'INTERNATIONAL';
}

export function CrisisModal({ 
  isOpen, 
  onClose, 
  crisisLevel = 'HIGH',
  crisisMessage = '',
  onAcknowledgeSafe 
}) {
  const [region] = useState(detectRegion());
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [hasClickedResource, setHasClickedResource] = useState(false);

  const resources = CRISIS_RESOURCES[region] || CRISIS_RESOURCES.INTERNATIONAL;
  const isCritical = crisisLevel === 'CRITICAL';

  // Prevent closing modal without acknowledgment for CRITICAL level
  const handleClose = () => {
    if (isCritical && !hasClickedResource) {
      setShowExitConfirm(true);
      return;
    }
    onClose();
  };

  const handleResourceClick = (resource) => {
    setHasClickedResource(true);
    if (resource.isLink) {
      window.open(resource.action, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = resource.action;
    }
  };

  const handleAcknowledgeSafe = () => {
    if (onAcknowledgeSafe) {
      onAcknowledgeSafe();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className={`p-4 ${isCritical ? 'bg-red-500' : 'bg-amber-500'} text-white`}>
          <div className="flex items-center gap-3">
            {isCritical ? (
              <AlertTriangle className="w-6 h-6" />
            ) : (
              <Heart className="w-6 h-6" />
            )}
            <h2 className="text-lg font-semibold">
              {isCritical ? "I'm really concerned about you" : "I want to make sure you're okay"}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          
          {/* Empathetic message */}
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            {crisisMessage || (isCritical
              ? "What you're going through sounds really hard. Your safety matters more than anything right now. Please reach out to someone who can help."
              : "It sounds like you're carrying a lot right now. You don't have to go through this alone. There are people who want to help."
            )}
          </p>

          {/* Resources */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Reach out now — these are free and confidential:
            </p>

            {/* Primary Resource */}
            <button
              onClick={() => handleResourceClick(resources.primary)}
              className={`w-full p-4 rounded-xl border-2 ${
                isCritical 
                  ? 'border-red-200 bg-red-50 dark:bg-red-900/20 hover:bg-red-100' 
                  : 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100'
              } transition-colors text-left group`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isCritical ? 'bg-red-500' : 'bg-amber-500'
                  } text-white`}>
                    {resources.primary.isLink ? <ExternalLink className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {resources.primary.name}
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {resources.primary.number}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {resources.primary.description}
                    </p>
                  </div>
                </div>
                <span className="text-gray-400 group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>

            {/* Secondary Resource */}
            <button
              onClick={() => handleResourceClick(resources.secondary)}
              className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-600">
                  {resources.secondary.isLink ? <ExternalLink className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                    {resources.secondary.name}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {resources.secondary.number}
                  </p>
                </div>
              </div>
            </button>

            {/* Emergency (for CRITICAL only) */}
            {isCritical && resources.emergency && (
              <button
                onClick={() => handleResourceClick(resources.emergency)}
                className="w-full p-3 rounded-xl border-2 border-red-500 bg-white dark:bg-gray-800 hover:bg-red-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 text-white">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-bold text-red-600 dark:text-red-400">
                      {resources.emergency.name}: {resources.emergency.number}
                    </p>
                    <p className="text-xs text-gray-500">
                      {resources.emergency.description}
                    </p>
                  </div>
                </div>
              </button>
            )}
          </div>

          {/* I'm Safe button */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleAcknowledgeSafe}
              className="w-full py-3 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
            >
              I'm okay right now
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2">
              I'm here for you. Let me know how you're doing.
            </p>
          </div>
        </div>

        {/* Exit Confirmation (for CRITICAL when trying to close without action) */}
        {showExitConfirm && (
          <div className="absolute inset-0 bg-white/95 dark:bg-gray-900/95 flex items-center justify-center p-6">
            <div className="text-center space-y-4">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Before you go
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                I really want to make sure you're safe. Please consider reaching out to one of the resources above.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium"
                >
                  Show me resources
                </button>
                <button
                  onClick={() => {
                    setShowExitConfirm(false);
                    onClose();
                  }}
                  className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium"
                >
                  Close anyway
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default CrisisModal;
