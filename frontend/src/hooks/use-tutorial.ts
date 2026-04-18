import { useContext } from "react";
import {
  TutorialContext,
  type TutorialContextValue,
} from "@/lib/tutorial-context-value";

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error("useTutorial must be used inside <TutorialProvider>");
  }
  return ctx;
}
