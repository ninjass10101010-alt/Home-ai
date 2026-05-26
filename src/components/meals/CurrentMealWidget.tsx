import { useState, useEffect } from "react";
import { db } from "@/db";

interface MealSchedule {
  id: number;
  title: string;
  time: string;
  emoji: string;
  type: string;
  color: string;
}

export default function CurrentMealWidget() {
  const [currentMealType, setCurrentMealType] = useState<string>("Breakfast");
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [upcomingMealSchedule, setUpcomingMealSchedule] = useState<MealSchedule | null>(null);
  const [activeMealData, setActiveMealData] = useState<any>(null);

  useEffect(() => {
    // Determine the current or upcoming meal based on the schedule
    const updateMealType = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));

      const schedules = db.selectTodaysSchedulesRaw();
      const mealSchedules = schedules.filter((s: any) => 
        s.title.toLowerCase().includes("breakfast") || 
        s.title.toLowerCase().includes("lunch") || 
        s.title.toLowerCase().includes("dinner")
      );

      const currentHour = now.getHours();
      
      let newMealType = "Dinner";
      if (currentHour < 11) {
        newMealType = "Breakfast";
      } else if (currentHour >= 11 && currentHour < 16) {
        newMealType = "Lunch";
      } else {
        newMealType = "Dinner";
      }
      setCurrentMealType(newMealType);
      setUpcomingMealSchedule(mealSchedules.find((s: any) => s.title.toLowerCase().includes(newMealType.toLowerCase())) || null);

      // Find the actual meal data for this day and type
      const todayShort = now.toLocaleDateString("en-US", { weekday: "short" });
      const allMeals = db.selectMeals(); // Gets all saved meals
      const meal = allMeals.find((m: any) => m.time === todayShort && m.mealType === newMealType.toLowerCase());
      // Fallback: If no mealType is set, just take the first one for the day if it's dinner time
      const fallbackMeal = allMeals.find((m: any) => m.time === todayShort);
      
      setActiveMealData(meal || (newMealType === "Dinner" ? fallbackMeal : null));
    };

    updateMealType();
    const interval = setInterval(updateMealType, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Determine gradients based on meal type (Weather dashboard feel)
  const getTheme = () => {
    switch (currentMealType) {
      case "Breakfast": return { bg: "from-amber-400/20 to-orange-500/20", border: "border-amber-400/30", text: "text-amber-500", icon: "🌅" };
      case "Lunch": return { bg: "from-sky-400/20 to-blue-500/20", border: "border-sky-400/30", text: "text-sky-400", icon: "☀️" };
      case "Dinner": return { bg: "from-indigo-500/20 to-purple-600/20", border: "border-indigo-400/30", text: "text-indigo-400", icon: "🌙" };
      default: return { bg: "from-nori-400/20 to-nori-600/20", border: "border-nori-400/30", text: "text-nori-400", icon: "✨" };
    }
  };

  const theme = getTheme();

  return (
    <div className={`relative overflow-hidden rounded-3xl p-5 border bg-gradient-to-br ${theme.bg} ${theme.border} shadow-xl`} style={{ backdropFilter: "blur(16px)" }}>
      {/* Background decorations */}
      <div className="absolute top-[-20%] right-[-10%] text-9xl opacity-10 pointer-events-none" style={{ filter: "blur(4px)", animation: "pulse 4s infinite" }}>
        {theme.icon}
      </div>

      <div className="flex items-center justify-between mb-2 relative z-10">
        <h2 className="text-text-primary font-bold text-lg flex items-center gap-2">
          <span>{theme.icon}</span> 
          Current Meal: {currentMealType}
        </h2>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg bg-surface-0/50 ${theme.text}`}>
          {currentTimeStr}
        </span>
      </div>

      <p className="text-text-secondary text-sm mb-4 relative z-10">
        {upcomingMealSchedule ? `Scheduled for ${upcomingMealSchedule.time}` : `No schedule found for ${currentMealType}`}
      </p>

      {/* The main dish displaying like a weather condition */}
      <div className="bg-surface-0/40 border border-surface-0/20 rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden backdrop-blur-md z-10">
        <div 
          className="w-16 h-16 rounded-2xl bg-surface-0/50 flex items-center justify-center text-4xl shrink-0 shadow-lg"
          style={{ animation: "float 3s ease-in-out infinite" }}
        >
          {activeMealData?.emoji || "🍽️"}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-text-primary font-bold text-xl leading-tight truncate">
            {activeMealData ? activeMealData.name : "Waiting for plan..."}
          </h3>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {activeMealData?.tags?.map((t: string) => (
              <span key={t} className="px-2 py-0.5 rounded-md bg-surface-0/50 text-text-primary text-[10px] font-medium shadow-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
