import { useEffect } from "react";
import { checkForAppUpdate } from "@/lib/updater";

/** Silent check on launch; prompts only when an update exists. */
export function UpdateChecker() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForAppUpdate(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
