"use client";

import React from "react";

class SettingsErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error("[Settings Error]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return <div className="p-4 text-red-500">Error: {String(this.state.error)}</div>;
    }
    return this.props.children;
  }
}

export default SettingsErrorBoundary;