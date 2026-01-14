/**
 * AgentOS Design System
 *
 * A collection of reusable UI components that follow AgentOS design guidelines:
 * - No strong borders, uses subtle shadows instead
 * - Purple theme (HSL hue 270)
 * - Mobile-first design
 * - Consistent styling across the app
 *
 * All components are prefixed with "A" (for AgentOS).
 */

// Core components
export { ATooltip, type ATooltipProps } from "./ATooltip";
export {
  AButton,
  type AButtonProps,
  type AButtonSize,
  type AButtonVariant,
} from "./AButton";
export {
  AIconButton,
  type AIconButtonProps,
  type AIconButtonSize,
  type AIconButtonHighlight,
} from "./AIconButton";
export { ADialog, type ADialogProps } from "./ADialog";
export {
  ABadge,
  type ABadgeProps,
  type ABadgeSize,
  type ABadgeVariant,
} from "./ABadge";

// Dropdown menu with factory functions
export {
  ADropdownMenu,
  type ADropdownMenuProps,
  type MenuItemConfig,
  type ToggleItemConfig,
  type SubmenuItemConfig,
  type SeparatorItemConfig,
  type CustomItemConfig,
  type DropdownItemConfig,
  menuItem,
  toggleItem,
  submenuItem,
  separator,
  customItem,
} from "./ADropdownMenu";

// Sheet (slide-out panel)
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
} from "./ASheet";
