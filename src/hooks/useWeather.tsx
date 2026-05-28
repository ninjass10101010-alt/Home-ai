'use client';

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  ReactNode,
} from 'react';
import {
  WeatherConfig,
  TemperatureUnit,
  TimeOfDay,
  Season,
  HolidayOverride,
  defaultWeatherConfig,
  WEATHER_STORAGE_KEY,
} from '@/lib/weather-config';

// ─── Context ────────────────────────────────────────────────────────────────

interface WeatherContextValue {
  weather: WeatherConfig;
  setLocation: (location: string) => void;
  setUnit: (unit: TemperatureUnit) => void;
  setTimeOfDay: (timeOfDay: TimeOfDay) => void;
  setSeason: (season: Season) => void;
  setHolidayOverride: (holidayOverride: HolidayOverride) => void;
}

const WeatherContext = createContext<WeatherContextValue | undefined>(undefined);

// ─── Hook ────────────────────────────────────────────────────────────────────

export const useWeatherConfig = (): WeatherContextValue => {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeatherConfig must be used within WeatherProvider');
  return ctx;
};

// ─── Provider ────────────────────────────────────────────────────────────────

const VALID_TOD: TimeOfDay[] = ['auto', 'day', 'night'];
const VALID_SEASONS: Season[] = ['auto', 'spring', 'summer', 'autumn', 'winter'];
const VALID_HOLIDAYS: HolidayOverride[] = ['auto', 'none', 'christmas', 'halloween', 'july4th', 'valentines', 'newyears', 'cincodemayo', 'thanksgiving', 'stpatricks'];

export const WeatherProvider = ({ children }: { children: ReactNode }) => {
  const [weather, setWeather] = useState<WeatherConfig>(defaultWeatherConfig);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(WEATHER_STORAGE_KEY);
      if (stored) {
        const parsed: Partial<WeatherConfig> = JSON.parse(stored);
        setWeather({
          location:
            typeof parsed.location === 'string' && parsed.location.trim()
              ? parsed.location.trim()
              : defaultWeatherConfig.location,
          unit: parsed.unit === 'C' ? 'C' : 'F',
          timeOfDay: VALID_TOD.includes(parsed.timeOfDay as TimeOfDay)
            ? (parsed.timeOfDay as TimeOfDay)
            : defaultWeatherConfig.timeOfDay,
          season: VALID_SEASONS.includes(parsed.season as Season)
            ? (parsed.season as Season)
            : defaultWeatherConfig.season,
          holidayOverride: VALID_HOLIDAYS.includes(parsed.holidayOverride as HolidayOverride)
            ? (parsed.holidayOverride as HolidayOverride)
            : defaultWeatherConfig.holidayOverride,
        });
      }
    } catch {
      // ignore parse errors, keep defaults
    }
  }, []);

  // Persist to localStorage whenever config changes (only after mount)
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(weather));
    }
  }, [weather, mounted]);

  const setLocation = useCallback((location: string) => {
    setWeather((prev) => ({ ...prev, location }));
  }, []);

  const setUnit = useCallback((unit: TemperatureUnit) => {
    setWeather((prev) => ({ ...prev, unit }));
  }, []);

  const setTimeOfDay = useCallback((timeOfDay: TimeOfDay) => {
    setWeather((prev) => ({ ...prev, timeOfDay }));
  }, []);

  const setSeason = useCallback((season: Season) => {
    setWeather((prev) => ({ ...prev, season }));
  }, []);

  const setHolidayOverride = useCallback((holidayOverride: HolidayOverride) => {
    setWeather((prev) => ({ ...prev, holidayOverride }));
  }, []);

  return (
    <WeatherContext.Provider value={{ weather, setLocation, setUnit, setTimeOfDay, setSeason, setHolidayOverride }}>
      {children}
    </WeatherContext.Provider>
  );
};
