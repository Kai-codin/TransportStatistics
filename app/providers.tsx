"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import ConvexClientProvider from "./ConvexClientProvider";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";
import type { ReactNode } from "react";

const CLERK_THEME_VARIABLES = {
  dark: {
    colorBackground: "#0d1410",
    colorForeground: "#e8f0e4",
    colorMutedForeground: "#9ab89a",
    colorInput: "#141e17",
    colorInputForeground: "#e8f0e4",
    colorNeutral: "white",
    colorPrimary: "#34d064",
    colorPrimaryForeground: "#0d1410",
  },
  light: {
    colorBackground: "#f7f8fa",
    colorForeground: "#1e2732",
    colorMutedForeground: "#556270",
    colorInput: "#ffffff",
    colorInputForeground: "#1e2732",
    colorNeutral: "#1e2732",
    colorPrimary: "#1f8f52",
    colorPrimaryForeground: "#ffffff",
  },
  bright: {
    colorBackground: "#ffffff",
    colorForeground: "#18202b",
    colorMutedForeground: "#4f5f6f",
    colorInput: "#ffffff",
    colorInputForeground: "#18202b",
    colorNeutral: "#18202b",
    colorPrimary: "#34d064",
    colorPrimaryForeground: "#0d1410",
  },
} as const;

function ClerkThemeBridge({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const clerkVariables = CLERK_THEME_VARIABLES[theme];

  return <ClerkProvider appearance={{ theme: dark, variables: clerkVariables }}>{children}</ClerkProvider>;
}

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ClerkThemeBridge>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </ClerkThemeBridge>
    </ThemeProvider>
  );
}