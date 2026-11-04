import { Component, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

type Props = { children: ReactNode; label: string; resetKey?: string | null };
type State = { failed: boolean; resetKey?: string | null };

/** A rendering failure must not unmount another panel or resubmit a job. */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="orbit-panel-error" role="alert" aria-label={`${this.props.label}: visningsfejl`}>
      <span className="orbit-panel-error-icon"><AlertCircle size={22} aria-hidden="true" /></span>
      <h2>{this.props.label} kunne ikke vises</h2>
      <p>Prøv at åbne denne visning igen. Det genindlæser kun panelet og sender ingen arbejdsopgaver igen.</p>
      <button type="button" className="btn-outline" onClick={() => this.setState({ failed: false })}><RotateCcw size={14} aria-hidden="true" /> Prøv panelet igen</button>
    </section>;
  }
}
