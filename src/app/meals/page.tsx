import { getMeals } from "@/actions/meals";
import { getGroceryItems, getPantryItems } from "@/actions/grocery";
import MealsUnified from "./MealsUnified";

export default async function MealsPage() {
  const [meals, groceryItems, pantryItems] = await Promise.all([
    getMeals(),
    getGroceryItems(),
    getPantryItems()
  ]);

  return (
    <MealsUnified 
      initialMeals={meals} 
      initialGrocery={groceryItems} 
      initialPantry={pantryItems} 
    />
  );
}
