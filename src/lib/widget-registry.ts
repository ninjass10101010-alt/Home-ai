import { ReactNode } from 'react';

export type WidgetCategory = 'Weather' | 'Schedule' | 'Events' | 'Tasks' | 'Meals';

export interface WidgetDefinition {
  id: string;
  category: WidgetCategory;
  title: string;
  defaultOrder: number;
  // Render prop or component reference for dynamic rendering
  render: (props?: any) => ReactNode;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'weather',
    category: 'Weather',
    title: 'Weather',
    defaultOrder: 0,
    render: (props) => null, // Will be replaced with actual component in usage
  },
  {
    id: 'schedule',
    category: 'Schedule',
    title: 'Daily Schedule',
    defaultOrder: 1,
    render: (props) => null,
  },
  {
    id: 'events',
    category: 'Events',
    title: "Today's Events",
    defaultOrder: 2,
    render: (props) => null,
  },
  {
    id: 'meals',
    category: 'Meals',
    title: "This Week's Meals",
    defaultOrder: 3,
    render: (props) => null,
  },
  {
    id: 'tasks',
    category: 'Tasks',
    title: 'Tasks',
    defaultOrder: 4,
    render: (props) => null,
  },
];

export const DEFAULT_WIDGET_ORDER = WIDGET_REGISTRY.sort((a, b) => a.defaultOrder - b.defaultOrder).map(w => w.id);

export type WidgetOrder = string[]; // array of widget ids in display order

export function getWidgetById(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find(w => w.id === id);
}
