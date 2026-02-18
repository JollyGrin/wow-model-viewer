# Phase 5: Polish

## Overview

Final polish pass covering responsive design, keyboard shortcuts, loading/error states, and accessibility.

## Goals

1. Responsive design (mobile-first)
2. Keyboard shortcuts
3. Loading/error states
4. Accessibility (ARIA, focus management)

## Tasks

### Responsive Design

- Mobile-friendly layout for all components
- Collapsible filters on mobile
- Touch-friendly tap targets
- Responsive timeline (vertical on mobile?)

### Keyboard Shortcuts

- `/` - Focus search
- `Escape` - Clear search / close dialogs
- `j/k` - Navigate items (optional)

### Loading States

- Skeleton loading for item list
- Loading spinner for data fetch
- Error boundary for crashes

### Accessibility

- Proper ARIA labels
- Focus management
- Color contrast
- Reduced motion support

## Implementation Notes

### Responsive Breakpoints

```css
/* Tailwind defaults */
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
```

### Keyboard Shortcut Hook

```typescript
function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === key && !e.ctrlKey && !e.metaKey) {
        // Don't trigger if user is typing
        if (e.target instanceof HTMLInputElement) return
        callback()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [key, callback])
}
```

## Verification

- [ ] Layout works on mobile (320px+)
- [ ] All interactive elements are keyboard accessible
- [ ] Loading states show during data fetch
- [ ] ARIA labels are present
- [ ] Color contrast meets WCAG AA
