import React from 'react';
import { FileText, Settings2, FolderOpen, Cpu, Compass } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

export type MainTab = 'reports' | 'inputs' | 'modeling' | 'projects' | 'solver';

interface BottomNavProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

const tabs: { id: MainTab; labelAr: string; icon: React.FC<LucideProps> }[] = [
  { id: 'projects', labelAr: 'المشاريع', icon: FolderOpen },
  { id: 'inputs', labelAr: 'المدخلات', icon: Settings2 },
  { id: 'modeling', labelAr: 'النمذجة', icon: Compass },
  { id: 'solver', labelAr: 'الحل', icon: Cpu },
  { id: 'reports', labelAr: 'التقارير', icon: FileText },
];

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <div className="bottom-nav-icon-wrap">
              <Icon size={22} strokeWidth={isActive ? 2.2 : 1.6} />
            </div>
            <span>{tab.labelAr}</span>
          </button>
        );
      })}
    </nav>
  );
}
