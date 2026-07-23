'use client';

import { Cloud, CloudRain, Droplets, Sun, Thermometer, Wind } from 'lucide-react';

interface WeatherWidgetProps {
  temperature: number;
  condition: string;
  high: number;
  low: number;
}

function getWeatherIcon(condition: string) {
  const lower = condition.toLowerCase();
  if (lower.includes('rain') || lower.includes('drizzle')) {
    return <CloudRain className="h-8 w-8 text-blue-500" />;
  }
  if (lower.includes('cloud') || lower.includes('overcast')) {
    return <Cloud className="h-8 w-8 text-gray-500" />;
  }
  return <Sun className="h-8 w-8 text-yellow-500" />;
}

export function WeatherWidget({ temperature, condition, high, low }: WeatherWidgetProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 to-primary/10 p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {getWeatherIcon(condition)}
            <div>
              <div className="text-3xl font-bold text-foreground">
                {temperature}°F
              </div>
              <div className="text-sm font-medium capitalize text-foreground">
                {condition}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="text-red-500">↑</span>
              <span>{high}°</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-blue-500">↓</span>
              <span>{low}°</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
