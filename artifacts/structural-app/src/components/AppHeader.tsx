import React from 'react';
import { Building2 } from 'lucide-react';

interface AppHeaderProps {
  title?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export default function AppHeader({ title = 'Structural Master', leftSlot, rightSlot }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-icon-btn shrink-0">
        {leftSlot ?? <Building2 size={20} />}
      </div>
      <h1 className="app-header-title flex-1 text-center">{title}</h1>
      <div className="flex items-center gap-1 shrink-0">
        {rightSlot}
      </div>
    </header>
  );
}
