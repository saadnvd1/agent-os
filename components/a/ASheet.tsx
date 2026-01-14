/**
 * ASheet - Design system Sheet component
 *
 * A slide-out panel that follows AgentOS design guidelines:
 * - No strong borders, uses subtle shadows instead
 * - Consistent styling across the app
 * - Wraps Radix Sheet primitive
 */

"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const ASheet = SheetPrimitive.Root;

const ASheetTrigger = SheetPrimitive.Trigger;

const ASheetClose = SheetPrimitive.Close;

const ASheetPortal = SheetPrimitive.Portal;

const ASheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60",
      className
    )}
    {...props}
    ref={ref}
  />
));
ASheetOverlay.displayName = "ASheetOverlay";

const aSheetVariants = cva(
  "fixed z-50 flex flex-col bg-background shadow-xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
);

interface ASheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof aSheetVariants> {
  /** Hide the default close button */
  hideCloseButton?: boolean;
}

const ASheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  ASheetContentProps
>(
  (
    { side = "right", className, children, hideCloseButton = false, ...props },
    ref
  ) => (
    <ASheetPortal>
      <ASheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(aSheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </ASheetPortal>
  )
);
ASheetContent.displayName = "ASheetContent";

const ASheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 p-4", className)} {...props} />
);
ASheetHeader.displayName = "ASheetHeader";

const ASheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
);
ASheetFooter.displayName = "ASheetFooter";

const ASheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-foreground text-base font-semibold", className)}
    {...props}
  />
));
ASheetTitle.displayName = "ASheetTitle";

const ASheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
));
ASheetDescription.displayName = "ASheetDescription";

export {
  ASheet,
  ASheetPortal,
  ASheetOverlay,
  ASheetTrigger,
  ASheetClose,
  ASheetContent,
  ASheetHeader,
  ASheetFooter,
  ASheetTitle,
  ASheetDescription,
};
