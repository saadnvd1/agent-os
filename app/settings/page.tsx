"use client";

import { SSHConnectionsSettings } from "@/components/Settings/SSHConnectionsSettings";

export default function SettingsPage() {
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b p-4">
        <h1 className="text-2xl font-bold">Settings</h1>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-8">
          <SSHConnectionsSettings />
        </div>
      </main>
    </div>
  );
}
