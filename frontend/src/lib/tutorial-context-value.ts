import { createContext } from "react";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  popoverPosition: "top" | "bottom" | "left" | "right";
  route?: string;
  advanceOn: "click" | "manual";
  nextLabel?: string;
}

export interface TutorialState {
  isActive: boolean;
  currentStepIndex: number;
  hasCompletedTutorial: boolean;
}

export interface TutorialContextValue {
  state: TutorialState;
  currentStep: TutorialStep | null;
  steps: TutorialStep[];
  startTutorial: () => void;
  skipTutorial: () => void;
  advanceStep: () => void;
  previousStep: () => void;
  resetTutorial: () => void;
}

export const TutorialContext = createContext<TutorialContextValue | null>(null);
