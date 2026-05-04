"use client";

import { Component, type ReactNode } from "react";

/**
 * React-Three-Fiber occasionally throws `target is null` from its
 * pointer-event connect path (events module line 16170) when the
 * canvas DOM ref hasn't attached yet on a fast remount. The library
 * has no public guard, so we catch the throw, schedule a remount via
 * `key` bump, and re-render the children. The error never reaches
 * the app shell.
 */
type State = { errorKey: number };

export class R3FErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { errorKey: 0 };

  static getDerivedStateFromError() {
    // We deliberately return new state to force a remount of the
    // subtree on the next render.
    return null;
  }

  componentDidCatch() {
    // Schedule a remount one tick later so the throwing component
    // has time to unmount its own broken state first.
    queueMicrotask(() => {
      this.setState((s) => ({ errorKey: s.errorKey + 1 }));
    });
  }

  render() {
    return (
      <div key={this.state.errorKey} style={{ display: "contents" }}>
        {this.props.children}
      </div>
    );
  }
}
