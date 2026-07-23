'use client';

import { getPB } from '@/lib/pb';
import { getWeatherData } from '@/hooks/useWeather';
import { getOutfitSuggestion, getRandomQuote } from '@/db/features/morning-briefing';
import type {
  DailyQuote,
  OutfitSuggestion,
  BriefingPreference,
} from '@/db/features/morning-briefing';

export interface MorningBriefingData {
  date: string;
  familyName: string;
  weather: {
    temperature: number;
    condition: string;
    high: number;
    low: number;
  } | null;
  outfitSuggestion: OutfitSuggestion | null;
  calendar: Array<{
    id: string;
    title: string;
    time: string;
    location?: string;
    attendees?: string[];
  }>;
  reminders: Array<{
    id: string;
    title: string;
    time: string;
    priority: 'low' | 'medium' | 'high';
  }>;
  quote: DailyQuote | null;
  showWeather: boolean;
  showCalendar: boolean;
  showReminders: boolean;
  showQuote: boolean;
}

export async function getBriefingData(): Promise<MorningBriefingData> {
  const pb = getPB();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Get family name (first user's name or default)
  let familyName = 'Family';
  try {
    const users = await pb.collection('users').getList(1, 1);
    if (users.items.length > 0) {
      familyName = users.items[0].name;
    }
  } catch (error) {
    console.error('Failed to get family name:', error);
  }

  // Get user preferences
  let preferences: BriefingPreference | null = null;
  try {
    const prefs = await pb.collection('briefing_preferences').getFullList();
    if (prefs.length > 0) {
      preferences = prefs[0] as unknown as BriefingPreference;
    }
  } catch (error) {
    console.error('Failed to get preferences:', error);
  }

  // Get weather data
  let weather: MorningBriefingData['weather'] = null;
  let outfitSuggestion: OutfitSuggestion | null = null;

  try {
    const weatherData = await getWeatherData();
    if (weatherData) {
      weather = {
        temperature: weatherData.current.temp_f,
        condition: weatherData.current.condition.text,
        high: weatherData.forecast.forecastday[0].day.maxtemp_f,
        low: weatherData.forecast.forecastday[0].day.mintemp_f,
      };

      // Get outfit suggestion
      outfitSuggestion = getOutfitSuggestion(
        weather.temperature,
        weather.condition.toLowerCase()
      );
    }
  } catch (error) {
    console.error('Failed to get weather data:', error);
  }

  // Get today's calendar events
  let calendar: MorningBriefingData['calendar'] = [];
  try {
    const today = now.toISOString().split('T')[0];
    const events = await pb
      .collection('calendar_events')
      .getList(1, 50, {
        filter: `date = "${today}"`,
        sort: 'time',
      });

    calendar = events.items.map((event: any) => ({
      id: event.id,
      title: event.title,
      time: event.time || '',
      location: event.location,
      attendees: event.attendees,
    }));
  } catch (error) {
    console.error('Failed to get calendar events:', error);
  }

  // Get active reminders
  let reminders: MorningBriefingData['reminders'] = [];
  try {
    const reminderList = await pb
      .collection('reminders')
      .getList(1, 20, {
        filter: 'status = "active"',
        sort: 'time',
      });

    reminders = reminderList.items.map((reminder: any) => ({
      id: reminder.id,
      title: reminder.title,
      time: reminder.time || '',
      priority: reminder.priority || 'medium',
    }));
  } catch (error) {
    console.error('Failed to get reminders:', error);
  }

  // Get daily quote
  let quote: DailyQuote | null = null;
  try {
    const quotes = await pb.collection('daily_quotes').getFullList();
    const preferredCategories = preferences?.preferredQuoteCategories || [];
    quote = getRandomQuote(quotes as unknown as DailyQuote[], preferredCategories);
  } catch (error) {
    console.error('Failed to get daily quote:', error);
  }

  return {
    date: dateStr,
    familyName,
    weather,
    outfitSuggestion,
    calendar,
    reminders,
    quote,
    showWeather: preferences?.showWeather ?? true,
    showCalendar: preferences?.showCalendar ?? true,
    showReminders: preferences?.showReminders ?? true,
    showQuote: preferences?.showQuote ?? true,
  };
}
