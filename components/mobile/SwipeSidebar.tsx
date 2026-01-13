"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SwipeSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Mobile sidebar with swipe gestures
 * Slides in from left, backdrop dismissal
 */
export function SwipeSidebar({ isOpen, onClose, children }: SwipeSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  // Handle swipe to close
  useEffect(() => {
    if (!isOpen) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (!sidebarRef.current) return;
      const sidebar = sidebarRef.current;
      const touch = e.touches[0];

      // Only start tracking if touch is within sidebar
      if (touch.clientX <= sidebar.offsetWidth) {
        touchStartX.current = touch.clientX;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartX.current === null) return;
      touchCurrentX.current = e.touches[0].clientX;

      // If swiping left, apply transform
      const diff = touchCurrentX.current - touchStartX.current;
      if (diff < 0 && sidebarRef.current) {
        sidebarRef.current.style.transform = `translateX(${diff}px)`;
      }
    };

    const handleTouchEnd = () => {
      if (touchStartX.current === null || touchCurrentX.current === null) {
        touchStartX.current = null;
        touchCurrentX.current = null;
        return;
      }

      const diff = touchCurrentX.current - touchStartX.current;

      // If swiped more than 50px left, close sidebar
      if (diff < -50) {
        onClose();
      }

      // Reset transform
      if (sidebarRef.current) {
        sidebarRef.current.style.transform = "";
      }

      touchStartX.current = null;
      touchCurrentX.current = null;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 z-40 transition-opacity md:hidden",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={cn(
          "fixed top-0 left-0 bottom-0 w-[280px] bg-background z-50 transition-transform duration-300 md:hidden",
          "flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Safe area spacer */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </aside>
    </>
  );
}
