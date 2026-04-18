import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTutorial } from "@/hooks/use-tutorial";

export function TutorialStartButton() {
  const { state, resetTutorial, startTutorial } = useTutorial();

  if (!state.hasCompletedTutorial || state.isActive) return null;

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        resetTutorial();
        startTutorial();
      }}
    >
      <PlayCircle className="h-4 w-4" />
      Replay tour
    </Button>
  );
}
