import { Component, type ReactNode } from "react";

/** Shows the error instead of a blank page; resets when the user navigates. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="notice danger-notice"><div><b>Ошибка интерфейса</b><p>{this.state.error.message}</p><p>Обновите страницу. Если повторяется — сообщите разработчикам.</p></div></div>;
  }
}
