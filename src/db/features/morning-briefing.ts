/**
 * Morning Briefing - Database Types
 * 
 * Daily contextual overview that appears when the dashboard is first opened.
 * Provides weather, calendar, reminders, and motivational content.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type QuoteCategory = 'motivational' | 'funny' | 'family' | 'wisdom' | 'kids' | 'gratitude';

export type BriefingSection = 'greeting' | 'weather' | 'calendar' | 'reminders' | 'quote' | 'tips';

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface DailyQuote {
  id: string;
  text: string;
  author: string;
  category: QuoteCategory;
  
  // Display
  emoji?: string;
  backgroundColor?: string; // hex color
  
  // Usage tracking
  timesShown: number;
  lastShownAt?: string;
  
  // Metadata
  isDefault: boolean; // system-provided
  createdBy?: string;
  createdAt: string;
}

export interface BriefingPreference {
  id: string;
  userId: string;
  
  // Sections to show
  showGreeting: boolean;
  showWeather: boolean;
  showCalendar: boolean;
  showReminders: boolean;
  showQuote: boolean;
  showTips: boolean;
  
  // Timing
  briefingStartTime: string; // "06:00" in 24h format
  briefingEndTime: string;   // "11:00" in 24h format
  autoDismissSeconds: number; // 10 seconds default
  skipAfterTime: string;     // "11:00" - skip if opened after this
  
  // Content preferences
  preferredQuoteCategories: QuoteCategory[];
  showOutfitSuggestion: boolean;
  showFamilyJoke: boolean;
  
  // Display
  animationEnabled: boolean;
  soundEnabled: boolean;
  
  createdAt: string;
  updatedAt: string;
}

export interface BriefingHistory {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  
  // What was shown
  sectionsShown: BriefingSection[];
  quoteId?: string;
  
  // User interaction
  viewedAt: string;
  dismissedAt?: string;
  dismissedByUser: boolean;
  fullDuration: boolean; // watched entire briefing
  
  // Context snapshot
  weatherCondition?: string;
  eventCount: number;
  reminderCount: number;
  
  createdAt: string;
}

export interface OutfitSuggestion {
  id: string;
  temperatureRange: string; // "cold", "cool", "mild", "warm", "hot"
  conditionTypes: string[]; // ["rainy", "snowy", "sunny", etc.]
  suggestion: string;
  emoji: string;
  items: string[]; // ["jacket", "umbrella", "sunglasses"]
}

// ─── PocketBase Collection Schemas ───────────────────────────────────────────

export const dailyQuotesSchema = {
  name: 'daily_quotes',
  type: 'base',
  fields: [
    { name: 'text', type: 'text', required: true },
    { name: 'author', type: 'text', required: true },
    { name: 'category', type: 'select', required: true, values: ['motivational', 'funny', 'family', 'wisdom', 'kids', 'gratitude'] },
    { name: 'emoji', type: 'text', required: false },
    { name: 'backgroundColor', type: 'text', required: false },
    { name: 'timesShown', type: 'number', required: true, defaultValue: 0 },
    { name: 'lastShownAt', type: 'date', required: false },
    { name: 'isDefault', type: 'bool', required: true, defaultValue: false },
    { name: 'createdBy', type: 'relation', required: false, collectionId: 'users' },
  ],
  indexes: [
    'CREATE INDEX idx_daily_quotes_category ON daily_quotes (category)',
    'CREATE INDEX idx_daily_quotes_times_shown ON daily_quotes (timesShown)',
  ],
};

export const briefingPreferencesSchema = {
  name: 'briefing_preferences',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'showGreeting', type: 'bool', required: true, defaultValue: true },
    { name: 'showWeather', type: 'bool', required: true, defaultValue: true },
    { name: 'showCalendar', type: 'bool', required: true, defaultValue: true },
    { name: 'showReminders', type: 'bool', required: true, defaultValue: true },
    { name: 'showQuote', type: 'bool', required: true, defaultValue: true },
    { name: 'showTips', type: 'bool', required: true, defaultValue: true },
    { name: 'briefingStartTime', type: 'text', required: true, defaultValue: '06:00' },
    { name: 'briefingEndTime', type: 'text', required: true, defaultValue: '11:00' },
    { name: 'autoDismissSeconds', type: 'number', required: true, defaultValue: 10 },
    { name: 'skipAfterTime', type: 'text', required: true, defaultValue: '11:00' },
    { name: 'preferredQuoteCategories', type: 'json', required: false },
    { name: 'showOutfitSuggestion', type: 'bool', required: true, defaultValue: true },
    { name: 'showFamilyJoke', type: 'bool', required: true, defaultValue: false },
    { name: 'animationEnabled', type: 'bool', required: true, defaultValue: true },
    { name: 'soundEnabled', type: 'bool', required: true, defaultValue: false },
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_briefing_prefs_user_id ON briefing_preferences (userId)',
  ],
};

export const briefingHistorySchema = {
  name: 'briefing_history',
  type: 'base',
  fields: [
    { name: 'userId', type: 'relation', required: true, collectionId: 'users', cascadeDelete: true },
    { name: 'date', type: 'text', required: true }, // YYYY-MM-DD
    { name: 'sectionsShown', type: 'json', required: true },
    { name: 'quoteId', type: 'relation', required: false, collectionId: 'daily_quotes' },
    { name: 'viewedAt', type: 'date', required: true },
    { name: 'dismissedAt', type: 'date', required: false },
    { name: 'dismissedByUser', type: 'bool', required: true, defaultValue: false },
    { name: 'fullDuration', type: 'bool', required: true, defaultValue: false },
    { name: 'weatherCondition', type: 'text', required: false },
    { name: 'eventCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'reminderCount', type: 'number', required: true, defaultValue: 0 },
  ],
  indexes: [
    'CREATE INDEX idx_briefing_history_user_id ON briefing_history (userId)',
    'CREATE INDEX idx_briefing_history_date ON briefing_history (date)',
    'CREATE UNIQUE INDEX idx_briefing_history_unique ON briefing_history (userId, date)',
  ],
};

// ─── Default Quotes Database ─────────────────────────────────────────────────

export const DEFAULT_QUOTES: Omit<DailyQuote, 'id' | 'createdAt' | 'timesShown'>[] = [
  // Motivational
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain", category: 'motivational', emoji: '🚀', isDefault: true },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt", category: 'motivational', emoji: '💪', isDefault: true },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela", category: 'motivational', emoji: '🏔️', isDefault: true },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs", category: 'motivational', emoji: '❤️', isDefault: true },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill", category: 'motivational', emoji: '🌟', isDefault: true },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson", category: 'motivational', emoji: '⏰', isDefault: true },
  { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis", category: 'motivational', emoji: '✨', isDefault: true },
  
  // Funny
  { text: "I'm not lazy, I'm on energy saving mode.", author: "Unknown", category: 'funny', emoji: '😴', isDefault: true },
  { text: "I'm not arguing, I'm just explaining why I'm right.", author: "Unknown", category: 'funny', emoji: '🤔', isDefault: true },
  { text: "My bed is a magical place where I suddenly remember everything I forgot to do.", author: "Unknown", category: 'funny', emoji: '🛏️', isDefault: true },
  { text: "I told my computer I needed a break, and now it won't stop sending me Kit Kat ads.", author: "Unknown", category: 'funny', emoji: '🍫', isDefault: true },
  { text: "I'm not clumsy, the floor just hates me, the table and chairs are bullies, and the walls get in my way.", author: "Unknown", category: 'funny', emoji: '🤸', isDefault: true },
  
  // Family
  { text: "Family is not an important thing. It's everything.", author: "Michael J. Fox", category: 'family', emoji: '👨‍👩‍👧‍👦', isDefault: true },
  { text: "The love of a family is life's greatest blessing.", author: "Unknown", category: 'family', emoji: '💝', isDefault: true },
  { text: "In family life, love is the oil that eases friction, the cement that binds closer, and the music that brings sweetness.", author: "Friedrich Nietzsche", category: 'family', emoji: '🎵', isDefault: true },
  { text: "Family means no one gets left behind or forgotten.", author: "David Ogden Stiers", category: 'family', emoji: '🤗', isDefault: true },
  { text: "Other things may change us, but we start and end with the family.", author: "Anthony Brandt", category: 'family', emoji: '🏠', isDefault: true },
  
  // Wisdom
  { text: "The only thing we have to fear is fear itself.", author: "Franklin D. Roosevelt", category: 'wisdom', emoji: '🧠', isDefault: true },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein", category: 'wisdom', emoji: '💡', isDefault: true },
  { text: "Life is what happens when you're busy making other plans.", author: "John Lennon", category: 'wisdom', emoji: '🌈', isDefault: true },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb", category: 'wisdom', emoji: '🌳', isDefault: true },
  { text: "Knowledge is power. Information is liberating.", author: "Kofi Annan", category: 'wisdom', emoji: '📖', isDefault: true },
  
  // Kids
  { text: "Every kid is an artist. The problem is how to remain an artist once we grow up.", author: "Pablo Picasso", category: 'kids', emoji: '🎨', isDefault: true },
  { text: "Children are not things to be molded, but people to be unfolded.", author: "Jess Lair", category: 'kids', emoji: '🌱', isDefault: true },
  { text: "It is easier to build strong children than to repair broken men.", author: "Frederick Douglass", category: 'kids', emoji: '💪', isDefault: true },
  { text: "Kids don't remember what you try to teach them. They remember what you are.", author: "Jim Henson", category: 'kids', emoji: '👨‍👧', isDefault: true },
  
  // Gratitude
  { text: "Gratitude turns what we have into enough.", author: "Aesop", category: 'gratitude', emoji: '🙏', isDefault: true },
  { text: "The more grateful I am, the more beauty I see.", author: "Mary Davis", category: 'gratitude', emoji: '🌸', isDefault: true },
  { text: "When you are grateful, fear disappears and abundance appears.", author: "Tony Robbins", category: 'gratitude', emoji: '✨', isDefault: true },
  { text: "Gratitude is not only the greatest of virtues but the parent of all others.", author: "Cicero", category: 'gratitude', emoji: '🌟', isDefault: true },
];

// ─── Outfit Suggestions ──────────────────────────────────────────────────────

export const OUTFIT_SUGGESTIONS: OutfitSuggestion[] = [
  { id: 'outfit-1', temperatureRange: 'cold', conditionTypes: ['snowy'], suggestion: 'Bundle up! Heavy coat, boots, hat, and gloves.', emoji: '🧥', items: ['heavy coat', 'boots', 'hat', 'gloves', 'scarf'] },
  { id: 'outfit-2', temperatureRange: 'cold', conditionTypes: ['rainy'], suggestion: 'Stay warm and dry! Coat, boots, and umbrella.', emoji: '🌂', items: ['coat', 'boots', 'umbrella'] },
  { id: 'outfit-3', temperatureRange: 'cold', conditionTypes: ['sunny', 'clear'], suggestion: 'Cold but clear! Warm layers and a jacket.', emoji: '🧣', items: ['warm layers', 'jacket', 'hat'] },
  { id: 'outfit-4', temperatureRange: 'cool', conditionTypes: ['rainy'], suggestion: 'Light jacket and umbrella should do it.', emoji: '🌂', items: ['light jacket', 'umbrella'] },
  { id: 'outfit-5', temperatureRange: 'cool', conditionTypes: ['default'], suggestion: 'A sweater or light jacket will keep you comfortable.', emoji: '🧥', items: ['sweater', 'light jacket'] },
  { id: 'outfit-6', temperatureRange: 'mild', conditionTypes: ['rainy'], suggestion: 'Light rain jacket and maybe an umbrella.', emoji: '🌦️', items: ['rain jacket', 'umbrella'] },
  { id: 'outfit-7', temperatureRange: 'mild', conditionTypes: ['default'], suggestion: 'Perfect weather! A light layer is all you need.', emoji: '👕', items: ['light layer'] },
  { id: 'outfit-8', temperatureRange: 'warm', conditionTypes: ['default'], suggestion: 'Warm day! Light clothing and maybe sunscreen.', emoji: '👕', items: ['light clothing', 'sunscreen'] },
  { id: 'outfit-9', temperatureRange: 'warm', conditionTypes: ['sunny'], suggestion: 'Hot and sunny! Stay cool with light clothes and sunscreen.', emoji: '☀️', items: ['light clothes', 'sunscreen', 'sunglasses', 'hat'] },
  { id: 'outfit-10', temperatureRange: 'hot', conditionTypes: ['default'], suggestion: 'Stay cool! Lightest clothing possible, lots of water.', emoji: '🥵', items: ['lightest clothing', 'water bottle', 'sunscreen', 'hat', 'sunglasses'] },
];

// ─── Helper Functions ────────────────────────────────────────────────────────

export function shouldShowBriefing(prefs: BriefingPreference): boolean {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  // Check if within briefing window
  if (currentTime < prefs.briefingStartTime || currentTime > prefs.briefingEndTime) {
    return false;
  }
  
  // Check if past skip time
  if (currentTime > prefs.skipAfterTime) {
    return false;
  }
  
  return true;
}

export function getOutfitSuggestion(tempF: number, condition: string): OutfitSuggestion | null {
  let tempRange: string;
  if (tempF < 40) tempRange = 'cold';
  else if (tempF < 60) tempRange = 'cool';
  else if (tempF < 75) tempRange = 'mild';
  else if (tempF < 85) tempRange = 'warm';
  else tempRange = 'hot';
  
  // Find matching suggestion
  const exact = OUTFIT_SUGGESTIONS.find(s => 
    s.temperatureRange === tempRange && s.conditionTypes.includes(condition)
  );
  if (exact) return exact;
  
  // Fallback to default for temp range
  return OUTFIT_SUGGESTIONS.find(s => 
    s.temperatureRange === tempRange && s.conditionTypes.includes('default')
  ) || null;
}

export function getRandomQuote(
  quotes: DailyQuote[],
  preferredCategories: QuoteCategory[] = [],
): DailyQuote | null {
  if (quotes.length === 0) return null;
  
  // Filter by preferred categories if specified
  let pool = quotes;
  if (preferredCategories.length > 0) {
    const preferred = quotes.filter(q => preferredCategories.includes(q.category));
    if (preferred.length > 0) pool = preferred;
  }
  
  // Prefer quotes not shown recently
  const fresh = pool.filter(q => q.timesShown === 0);
  if (fresh.length > 0) {
    return fresh[Math.floor(Math.random() * fresh.length)];
  }
  
  // Otherwise pick least-shown quote
  pool.sort((a, b) => a.timesShown - b.timesShown);
  const minShown = pool[0].timesShown;
  const leastShown = pool.filter(q => q.timesShown === minShown);
  
  return leastShown[Math.floor(Math.random() * leastShown.length)];
}
