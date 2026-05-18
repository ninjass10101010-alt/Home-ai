"use client";

import { useState } from "react";
import Card from "./Card";

interface WeatherData {
  day: string;
  date: string;
  high: number;
  low: number;
  condition: string;
  emoji: string;
  precipitation: number;
  humidity: number;
  wind: number;
}

interface WeatherWidgetProps {
  location?: string;
  currentTemp?: number;
  currentCondition?: string;
  currentEmoji?: string;
  forecast?: WeatherData[];
}

export default function WeatherWidget({
  location = "New York, NY",
  currentTemp = 72,
  currentCondition = "Partly Cloudy",
  currentEmoji = "⛅",
  forecast: initialForecast,
}: WeatherWidgetProps) {
  const [unit, setUnit] = useState<"F" | "C">("F");
  const [expanded, setExpanded] = useState(false);
  const [locationState, setLocationState] = useState(location);
  const [isEditingLocation, setIsEditingLocation] = useState(false);

  const forecast = initialForecast || [
    { day: "Tue", date: "May 12", high: 75, low: 62, condition: "Partly Cloudy", emoji: "⛅", precipitation: 10, humidity: 55, wind: 8 },
    { day: "Wed", date: "May 13", high: 78, low: 64, condition: "Sunny", emoji: "☀️", precipitation: 0, humidity: 45, wind: 6 },
    { day: "Thu", date: "May 14", high: 71, low: 58, condition: "Rainy", emoji: "🌧️", precipitation: 80, humidity: 75, wind: 12 },
    { day: "Fri", date: "May 15", high: 68, low: 55, condition: "Cloudy", emoji: "☁️", precipitation: 30, humidity: 65, wind: 10 },
    { day: "Sat", date: "May 16", high: 74, low: 60, condition: "Sunny", emoji: "🌤️", precipitation: 5, humidity: 50, wind: 7 },
  ];

  const convertTemp = (f: number) => {
    if (unit === "C") return Math.round((f - 32) * 5 / 9);
    return f;
  };

  const today = forecast[0];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-text-secondary text-xs font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
          {isEditingLocation ? (
            <input
              type="text"
              value={locationState}
              onChange={(e) => setLocationState(e.target.value)}
              onBlur={() => setIsEditingLocation(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingLocation(false); }}
              className="bg-surface-2 px-1 rounded text-xs w-24 focus:outline-none"
              autoFocus
            />
          ) : (
            <span onClick={() => setIsEditingLocation(true)} className="cursor-pointer hover:text-nori-400">{locationState}</span>
          )}
        </div>
        <button
          onClick={() => setUnit(unit === "F" ? "C" : "F")}
          className="text-text-muted text-[10px] hover:text-text-secondary transition-colors"
        >
          °{unit}
        </button>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <span className="text-5xl">{currentEmoji}</span>
        <div>
          <p className="text-text-primary text-3xl font-bold leading-tight">
            {convertTemp(currentTemp)}°
            <span className="text-text-muted text-xl font-normal">/{unit}</span>
          </p>
          <p className="text-text-secondary text-xs mt-0.5">
            Feels like {unit === "F" ? "74°" : "23°"} · {currentCondition}
          </p>
        </div>
      </div>

      <div className={`space-y-3 overflow-hidden transition-all duration-300 ${expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="pt-3 border-t border-surface-3">
          <div className="flex justify-between text-[10px] text-text-muted mb-2">
            <span>Precipitation: {today.precipitation}%</span>
            <span>Humidity: {today.humidity}%</span>
            <span>Wind: {today.wind} mph</span>
          </div>
        </div>
        <div className="pt-2 border-t border-surface-3">
          <p className="text-text-muted text-[10px] font-medium mb-2">5-Day Forecast</p>
          <div className="flex justify-between gap-1">
            {forecast.map((day) => (
              <div key={day.day} className="flex-1 text-center" title={`${day.condition} - High ${convertTemp(day.high)}° / Low ${convertTemp(day.low)}°`}>
                <p className="text-text-muted text-[10px]">{day.day}</p>
                <p className="text-xl">{day.emoji}</p>
                <p className="text-text-primary text-xs font-medium">
                  {convertTemp(day.high)}°/{convertTemp(day.low)}°
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full mt-3 text-[11px] text-nori-400 hover:text-nori-300 transition-colors font-medium flex items-center justify-center gap-1"
      >
        {expanded ? (
          <>
            Show less
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : (
          <>
            More details
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </button>
    </Card>
  );
}