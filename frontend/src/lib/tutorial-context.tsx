import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  TutorialContext,
  type TutorialState,
  type TutorialStep,
} from "@/lib/tutorial-context-value";

const STORAGE_KEY = "professionalbilling.tutorial";

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Professional Billing",
    description:
      "A quick tour of the app — under a minute. We'll point out the main sections so you know where everything lives.",
    targetSelector: '[data-tutorial-target="header-logo"]',
    popoverPosition: "bottom",
    route: "/",
    advanceOn: "manual",
  },
  {
    id: "time-entries",
    title: "Track your time",
    description:
      "Log billable hours here. Use a duration, a live timer, or explicit start/end times — whichever fits your workflow.",
    targetSelector: '[data-tutorial-target="nav-time"]',
    popoverPosition: "right",
    route: "/time",
    advanceOn: "click",
  },
  {
    id: "clients",
    title: "Manage clients",
    description:
      "Add the people and companies you bill. Set a default rate per client and it auto-populates on new time entries.",
    targetSelector: '[data-tutorial-target="nav-clients"]',
    popoverPosition: "right",
    route: "/clients",
    advanceOn: "click",
  },
  {
    id: "invoices",
    title: "Send invoices",
    description:
      "Turn unbilled time into invoices. Each open invoice gets a Stripe-powered payment link your client can pay online.",
    targetSelector: '[data-tutorial-target="nav-invoices"]',
    popoverPosition: "right",
    route: "/invoices",
    advanceOn: "click",
  },
  {
    id: "settings",
    title: "Set your defaults",
    description:
      "Set your default hourly rate and connect Stripe to start accepting card payments. You can also replay this tour from here.",
    targetSelector: '[data-tutorial-target="nav-settings"]',
    popoverPosition: "right",
    route: "/settings",
    advanceOn: "manual",
  },
  {
    id: "done",
    title: "You're all set",
    description:
      "That's the tour. Replay it anytime from the Settings page — look for \"Replay tour\" at the bottom.",
    targetSelector: '[data-tutorial-target="header-logo"]',
    popoverPosition: "bottom",
    route: "/",
    advanceOn: "manual",
    nextLabel: "Finish",
  },
];

function loadState(): { hasCompletedTutorial: boolean } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { hasCompletedTutorial: Boolean(parsed?.hasCompletedTutorial) };
    }
  } catch {
    /* localStorage unavailable */
  }
  return { hasCompletedTutorial: false };
}

function saveState(hasCompletedTutorial: boolean) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hasCompletedTutorial }),
    );
  } catch {
    /* localStorage unavailable */
  }
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TutorialState>(() => ({
    isActive: false,
    currentStepIndex: 0,
    hasCompletedTutorial: loadState().hasCompletedTutorial,
  }));

  useEffect(() => {
    if (!state.hasCompletedTutorial && !state.isActive) {
      setState((prev) => ({ ...prev, isActive: true, currentStepIndex: 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStep =
    state.isActive ? TUTORIAL_STEPS[state.currentStepIndex] ?? null : null;

  const startTutorial = useCallback(() => {
    setState((prev) => ({ ...prev, isActive: true, currentStepIndex: 0 }));
  }, []);

  const advanceStep = useCallback(() => {
    setState((prev) => {
      const nextIndex = prev.currentStepIndex + 1;
      if (nextIndex >= TUTORIAL_STEPS.length) {
        saveState(true);
        return { ...prev, isActive: false, hasCompletedTutorial: true };
      }
      return { ...prev, currentStepIndex: nextIndex };
    });
  }, []);

  const previousStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStepIndex: Math.max(0, prev.currentStepIndex - 1),
    }));
  }, []);

  const skipTutorial = useCallback(() => {
    saveState(true);
    setState((prev) => ({
      ...prev,
      isActive: false,
      hasCompletedTutorial: true,
    }));
  }, []);

  const resetTutorial = useCallback(() => {
    saveState(false);
    setState({
      isActive: false,
      currentStepIndex: 0,
      hasCompletedTutorial: false,
    });
  }, []);

  return (
    <TutorialContext.Provider
      value={{
        state,
        currentStep,
        steps: TUTORIAL_STEPS,
        startTutorial,
        skipTutorial,
        advanceStep,
        previousStep,
        resetTutorial,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}
