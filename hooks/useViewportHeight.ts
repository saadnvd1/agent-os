'use client';

import { useEffect } from 'react';

/**
 * Hook to set CSS custom property for actual viewport height.
 * Handles iOS Safari's virtual keyboard by using visualViewport API.
 *
 * Sets --app-height CSS variable on document root that updates when:
 * - Window resizes
 * - Visual viewport changes (keyboard appears/disappears)
 * - Orientation changes
 */
export function useViewportHeight() {
  useEffect(() => {
    const setAppHeight = () => {
      // Use visualViewport if available (more accurate on mobile with keyboard)
      const vh = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
    };

    // Set initial value
    setAppHeight();

    // Update on window resize
    window.addEventListener('resize', setAppHeight);

    // Visual viewport resize handles keyboard appearance on mobile
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setAppHeight);
      window.visualViewport.addEventListener('scroll', setAppHeight);
    }

    // Handle orientation changes
    if ('orientation' in screen) {
      screen.orientation.addEventListener('change', setAppHeight);
    }

    return () => {
      window.removeEventListener('resize', setAppHeight);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setAppHeight);
        window.visualViewport.removeEventListener('scroll', setAppHeight);
      }
      if ('orientation' in screen) {
        screen.orientation.removeEventListener('change', setAppHeight);
      }
    };
  }, []);
}
