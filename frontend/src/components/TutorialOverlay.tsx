import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTutorial } from "@/hooks/use-tutorial";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const POPOVER_MAX_WIDTH = 360;
const POPOVER_HEIGHT_ESTIMATE = 200;
const SPOTLIGHT_PADDING = 8;
const POPOVER_GAP = 12;
const RAF_RETRY_LIMIT = 30;

export function TutorialOverlay() {
  const {
    state,
    currentStep,
    steps,
    advanceStep,
    previousStep,
    skipTutorial,
  } = useTutorial();
  const navigate = useNavigate();
  const location = useLocation();
  const [targetRect, setTargetRect] = React.useState<TargetRect | null>(null);
  const [hasGivenUpMeasuring, setHasGivenUpMeasuring] = React.useState(false);
  const rafRef = React.useRef<number>(0);
  const rafCountRef = React.useRef<number>(0);

  const findAndMeasureRef = React.useRef<() => void>(() => {});
  const findAndMeasureTarget = React.useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
      rafCountRef.current = 0;
    } else if (rafCountRef.current < RAF_RETRY_LIMIT) {
      rafCountRef.current += 1;
      rafRef.current = requestAnimationFrame(() =>
        findAndMeasureRef.current(),
      );
    } else {
      // Give up — popover will render centered as fallback.
      setHasGivenUpMeasuring(true);
    }
  }, [currentStep]);

  React.useEffect(() => {
    findAndMeasureRef.current = findAndMeasureTarget;
  }, [findAndMeasureTarget]);

  // Synchronous first-measurement on step or route change. Runs before paint,
  // so when the target is already mounted (most cases) the popover renders at
  // its final position on the first frame — no center-to-target flash.
  React.useLayoutEffect(() => {
    if (!state.isActive || !currentStep) return;
    rafCountRef.current = 0;
    setHasGivenUpMeasuring(false);
    const el = document.querySelector(currentStep.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    } else {
      setTargetRect(null);
    }
  }, [state.isActive, currentStep, location.pathname]);

  // Navigate to the step's route if needed.
  React.useEffect(() => {
    if (!state.isActive || !currentStep?.route) return;
    if (location.pathname !== currentStep.route) {
      navigate(currentStep.route);
    }
  }, [state.isActive, currentStep, location.pathname, navigate]);

  // Async re-measurement after navigation / layout settles, plus listeners.
  React.useEffect(() => {
    if (!state.isActive || !currentStep) return;
    const t1 = window.setTimeout(findAndMeasureTarget, 200);
    const t2 = window.setTimeout(findAndMeasureTarget, 600);
    const onLayoutChange = () => findAndMeasureTarget();
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [state.isActive, currentStep, findAndMeasureTarget, location.pathname]);

  // Click-advance: when advanceOn === 'click', listen for clicks on the target.
  React.useEffect(() => {
    if (!state.isActive || !currentStep || currentStep.advanceOn !== "click") {
      return;
    }
    const handleClick = (e: MouseEvent) => {
      const target = document.querySelector(currentStep.targetSelector);
      if (
        target &&
        (target === e.target || target.contains(e.target as Node))
      ) {
        window.setTimeout(advanceStep, 300);
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [state.isActive, currentStep, advanceStep]);

  // ESC dismisses (counts as skip).
  React.useEffect(() => {
    if (!state.isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipTutorial();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.isActive, skipTutorial]);

  if (!state.isActive || !currentStep) return null;

  const stepNumber = state.currentStepIndex + 1;
  const totalSteps = steps.length;
  const isFirstStep = state.currentStepIndex === 0;
  const isLastStep = state.currentStepIndex === totalSteps - 1;

  const popoverStyle: React.CSSProperties = {};
  if (targetRect) {
    switch (currentStep.popoverPosition) {
      case "bottom":
        popoverStyle.top = Math.min(
          targetRect.top + targetRect.height + POPOVER_GAP,
          window.innerHeight - POPOVER_HEIGHT_ESTIMATE - 8,
        );
        popoverStyle.left = Math.max(
          8,
          Math.min(targetRect.left, window.innerWidth - POPOVER_MAX_WIDTH - 8),
        );
        break;
      case "top":
        popoverStyle.bottom = Math.max(
          8,
          window.innerHeight - targetRect.top + POPOVER_GAP,
        );
        popoverStyle.left = Math.max(
          8,
          Math.min(targetRect.left, window.innerWidth - POPOVER_MAX_WIDTH - 8),
        );
        break;
      case "left":
        popoverStyle.top = Math.max(
          8,
          Math.min(
            targetRect.top,
            window.innerHeight - POPOVER_HEIGHT_ESTIMATE - 8,
          ),
        );
        popoverStyle.right = window.innerWidth - targetRect.left + POPOVER_GAP;
        break;
      case "right":
        popoverStyle.top = Math.max(
          8,
          Math.min(
            targetRect.top,
            window.innerHeight - POPOVER_HEIGHT_ESTIMATE - 8,
          ),
        );
        popoverStyle.left = targetRect.left + targetRect.width + POPOVER_GAP;
        break;
    }
  } else {
    popoverStyle.top = "50%";
    popoverStyle.left = "50%";
    popoverStyle.transform = "translate(-50%, -50%)";
  }

  // Hide the popover while the async measurement loop is still running for
  // the current step — prevents a center-to-target flash on step change.
  if (!targetRect && !hasGivenUpMeasuring) {
    popoverStyle.visibility = "hidden";
  }

  return (
    <>
      {targetRect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-lg ring-2 ring-[var(--color-primary)]"
          style={{
            top: targetRect.top - SPOTLIGHT_PADDING,
            left: targetRect.left - SPOTLIGHT_PADDING,
            width: targetRect.width + SPOTLIGHT_PADDING * 2,
            height: targetRect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 z-50 bg-black/55" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-step-title"
        className="fixed z-[60] w-[min(360px,calc(100vw-16px))] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[var(--color-card-foreground)] shadow-xl"
        style={popoverStyle}
      >
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Step {stepNumber} of {totalSteps}
        </p>
        <h3
          id="tutorial-step-title"
          className="mt-1 text-base font-semibold tracking-tight"
        >
          {currentStep.title}
        </h3>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          {currentStep.description}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={skipTutorial}
          >
            Skip
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={previousStep}
              disabled={isFirstStep}
            >
              Back
            </Button>
            <Button type="button" size="sm" onClick={advanceStep}>
              {currentStep.nextLabel ?? (isLastStep ? "Finish" : "Next")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
