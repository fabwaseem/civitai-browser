import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional label for the recovery UI */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render crashes so a gallery/filter blow-up doesn't blank the
 * entire frameless window (title bar + controls live in the React tree).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const label = this.props.label ?? "Something went wrong";

    return (
      <div className="grid h-full place-items-center px-6">
        <div
          className="w-full max-w-md rounded-lg px-5 py-6 text-center"
          style={{
            background: "rgba(15, 22, 20, 0.94)",
            border: "1px solid rgba(255, 123, 138, 0.28)",
            boxShadow: "0 14px 44px rgba(0, 0, 0, 0.45)",
          }}
        >
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-danger/15 text-danger">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <h2 className="text-sm font-medium text-fg">{label}</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            The gallery hit an unexpected error. Your filters are still set —
            try again, or refresh.
          </p>
          <Button className="mt-4" size="sm" onClick={this.reset}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
