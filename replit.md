# Workspace

## Overview

pnpm workspace monorepo — Structural Master Engineering App (Arabic/RTL). Two main artifacts:
1. **Web App** (React + Vite + Tailwind) — migrated from Lovable.dev
2. **Mobile App** (Expo Router) — new React Native mobile version

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9

### Web App (`artifacts/structural-app`)
- React 18 + Vite + Tailwind CSS v3 (PostCSS, NOT @tailwindcss/vite)
- shadcn/ui components, react-router-dom with basename
- Language: Arabic (RTL)
- No backend — pure frontend structural calculations

### Mobile App (`artifacts/structural-mobile`)
- Expo Router (file-based routing), React Native
- AsyncStorage for local data persistence (no backend)
- @expo/vector-icons (Feather + MaterialCommunityIcons)
- expo-haptics for tactile feedback
- Language: Arabic labels, English engineering terms

## Mobile App Structure

```
artifacts/structural-mobile/
  app/
    _layout.tsx          — Root layout, wraps ProjectProvider
    (tabs)/
      _layout.tsx        — Tab bar (4 tabs)
      index.tsx          — Projects list screen
      design.tsx         — Add beams/columns (CRUD)
      results.tsx        — Analysis results with utilization bars
      calculator.tsx     — Quick standalone calculator
  components/
    StatusBadge.tsx      — Safe/Warning/Danger pill
    UtilizationBar.tsx   — Animated progress bar
    ResultCard.tsx       — Metric result card
    ErrorBoundary.tsx
  context/
    ProjectContext.tsx   — CRUD state + AsyncStorage persistence
  lib/
    structuralCalc.ts    — ACI 318 beam + column design calculations
  constants/
    colors.ts            — Navy/blue engineering color palette
  hooks/
    useColors.ts         — Light/dark mode color hook
```

## Key Commands

- `pnpm --filter @workspace/structural-app run dev` — Web app dev server
- `pnpm --filter @workspace/structural-mobile run dev` — Expo dev server

## Notes

- Web app runs at preview path `/structural-app`
- Mobile app runs at preview path `/mobile`
- Android APK generation requires EAS Build (Expo Application Services) — not available directly in Replit
- To build APK: run `eas build -p android` via EAS CLI after `expo login`
