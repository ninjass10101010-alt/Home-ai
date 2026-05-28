// Type definitions for weather widget configuration
export type TemperatureUnit = 'F' | 'C';
export type TimeOfDay = 'auto' | 'day' | 'night';
export type Season = 'auto' | 'spring' | 'summer' | 'autumn' | 'winter';
export type HolidayOverride = 'auto' | 'none' | 'christmas' | 'halloween' | 'july4th' | 'valentines' | 'newyears' | 'cincodemayo' | 'thanksgiving' | 'stpatricks';


export interface WeatherConfig {
  location: string;
  unit: TemperatureUnit;
  timeOfDay: TimeOfDay;
  season: Season;
  holidayOverride: HolidayOverride;
}

// Default weather configuration
export const defaultWeatherConfig: WeatherConfig = {
  location: 'New York, NY',
  unit: 'F',
  timeOfDay: 'auto',
  season: 'auto',
  holidayOverride: 'auto',
};

// Storage key for weather configuration
export const WEATHER_STORAGE_KEY = 'home-ai-weather-config';

