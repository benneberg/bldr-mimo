import React from 'react';

interface ArchitecturePanelProps {
  projectId: string;
}

export function ArchitecturePanel({ projectId }: ArchitecturePanelProps) {
  return (
    <div className="flex items-center justify-center h-full text-mimo-text-muted">
      <p>Architecture view for project {projectId} — coming soon.</p>
    </div>
  );
}
